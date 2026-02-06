import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-server-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

interface DDNSUpdateRequest {
  provider?: string
  hostname?: string
  ip?: string
  cron?: boolean
}

interface DDNSUpdateResponse {
  success: boolean
  message: string
  ip?: string
  hostname?: string
  provider?: string
  response_code?: string
}

// Provider-specific response codes
const NOIP_RESPONSE_CODES: Record<string, { success: boolean; message: string }> = {
  'good': { success: true, message: 'IP address updated successfully' },
  'nochg': { success: true, message: 'IP address has not changed' },
  'nohost': { success: false, message: 'Hostname not found. No-IP uses domains like *.ddns.net, *.hopto.org - not custom domains' },
  'badauth': { success: false, message: 'Invalid username/password' },
  'badagent': { success: false, message: 'Client blocked by provider' },
  '!donator': { success: false, message: 'Feature not available for free accounts' },
  'abuse': { success: false, message: 'Hostname blocked due to abuse' },
  '911': { success: false, message: 'Server error, retry later' },
}

const DUCKDNS_RESPONSE_CODES: Record<string, { success: boolean; message: string }> = {
  'ok': { success: true, message: 'IP address updated successfully' },
  'ko': { success: false, message: 'Update failed - check token and subdomain' },
}

async function getCurrentIP(): Promise<string> {
  try {
    const response = await fetch('https://api.ipify.org?format=json')
    const data = await response.json()
    return data.ip
  } catch {
    const response = await fetch('https://ifconfig.me/ip')
    return (await response.text()).trim()
  }
}

async function updateNoIP(hostname: string, ip: string, username: string, password: string): Promise<DDNSUpdateResponse> {
  const auth = btoa(`${username}:${password}`)
  const url = `https://dynupdate.no-ip.com/nic/update?hostname=${encodeURIComponent(hostname)}&myip=${encodeURIComponent(ip)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Basic ${auth}`, 'User-Agent': 'WireGuard-Manager/1.0 admin@wireguard-manager.local' }
  })
  const responseText = await response.text()
  const responseCode = responseText.split(' ')[0].toLowerCase().trim()
  const result = NOIP_RESPONSE_CODES[responseCode] || { success: false, message: `Unknown response: ${responseText}` }
  return { success: result.success, message: result.message, ip, hostname, provider: 'noip', response_code: responseCode }
}

async function updateDuckDNS(hostname: string, ip: string, token: string): Promise<DDNSUpdateResponse> {
  const subdomain = hostname.replace('.duckdns.org', '')
  const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(subdomain)}&token=${encodeURIComponent(token)}&ip=${encodeURIComponent(ip)}`
  const response = await fetch(url)
  const responseText = (await response.text()).trim().toLowerCase()
  const result = DUCKDNS_RESPONSE_CODES[responseText] || { success: false, message: `Unknown response: ${responseText}` }
  return { success: result.success, message: result.message, ip, hostname, provider: 'duckdns', response_code: responseText }
}

async function updateDynu(hostname: string, ip: string, username: string, password: string): Promise<DDNSUpdateResponse> {
  const auth = btoa(`${username}:${password}`)
  const url = `https://api.dynu.com/nic/update?hostname=${encodeURIComponent(hostname)}&myip=${encodeURIComponent(ip)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Basic ${auth}`, 'User-Agent': 'WireGuard-Manager/1.0' }
  })
  const responseText = await response.text()
  const responseCode = responseText.split(' ')[0].toLowerCase().trim()
  const result = NOIP_RESPONSE_CODES[responseCode] || {
    success: responseText.toLowerCase().includes('good') || responseText.toLowerCase().includes('nochg'),
    message: responseText
  }
  return { success: result.success, message: result.message, ip, hostname, provider: 'dynu', response_code: responseCode }
}

async function updateFreeDNS(hostname: string, ip: string, token: string): Promise<DDNSUpdateResponse> {
  const url = `https://freedns.afraid.org/dynamic/update.php?${token}&address=${encodeURIComponent(ip)}`
  const response = await fetch(url)
  const responseText = await response.text()
  const success = responseText.toLowerCase().includes('updated') || responseText.toLowerCase().includes('no ip change')
  return { success, message: success ? 'IP updated successfully' : responseText, ip, hostname, provider: 'freedns', response_code: success ? 'ok' : 'error' }
}

async function updateCloudflare(hostname: string, ip: string, token: string, zoneId: string): Promise<DDNSUpdateResponse> {
  const listUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}&type=A`
  const listResponse = await fetch(listUrl, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const listData = await listResponse.json()
  if (!listData.success || !listData.result || listData.result.length === 0) {
    return { success: false, message: 'DNS record not found. Create an A record first in Cloudflare.', ip, hostname, provider: 'cloudflare', response_code: 'not_found' }
  }
  const recordId = listData.result[0].id
  const updateUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`
  const updateResponse = await fetch(updateUrl, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: ip, ttl: 1 })
  })
  const updateData = await updateResponse.json()
  return {
    success: updateData.success,
    message: updateData.success ? 'IP updated successfully' : (updateData.errors?.[0]?.message || 'Update failed'),
    ip, hostname, provider: 'cloudflare',
    response_code: updateData.success ? 'ok' : 'error'
  }
}

async function updateCustom(hostname: string, ip: string, username: string, password: string, token: string, customUrl: string): Promise<DDNSUpdateResponse> {
  let url = customUrl
    .replace('{hostname}', encodeURIComponent(hostname))
    .replace('{ip}', encodeURIComponent(ip))
    .replace('{username}', encodeURIComponent(username))
    .replace('{password}', encodeURIComponent(password))
    .replace('{token}', encodeURIComponent(token))
  const headers: Record<string, string> = { 'User-Agent': 'WireGuard-Manager/1.0' }
  if (username && password) {
    headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`
  }
  const response = await fetch(url, { headers })
  const responseText = await response.text()
  const success = response.ok || responseText.toLowerCase().includes('good') || responseText.toLowerCase().includes('ok') || responseText.toLowerCase().includes('updated')
  return { success, message: success ? 'IP updated successfully' : responseText, ip, hostname, provider: 'custom', response_code: success ? 'ok' : 'error' }
}

// Health monitoring: track consecutive failures and send email alerts
async function checkHealthAndAlert(
  supabase: ReturnType<typeof createClient>,
  success: boolean,
  provider: string,
  hostname: string,
  errorMessage?: string
) {
  try {
    const failCountKey = 'ddns_consecutive_failures'
    const alertThresholdKey = 'ddns_failure_alert_threshold'
    const lastAlertKey = 'ddns_last_failure_alert'

    const { data: healthSettings } = await supabase
      .from('server_settings')
      .select('setting_key, setting_value')
      .in('setting_key', [failCountKey, alertThresholdKey, lastAlertKey, 'email_notifications_enabled', 'notification_email', 'smtp_host'])

    const config: Record<string, string> = {}
    healthSettings?.forEach((s: { setting_key: string; setting_value: string }) => {
      config[s.setting_key] = s.setting_value
    })

    const currentFailCount = parseInt(config[failCountKey] || '0')
    const alertThreshold = parseInt(config[alertThresholdKey] || '3')
    const now = new Date().toISOString()

    if (success) {
      // Reset failure counter on success
      if (currentFailCount > 0) {
        await supabase.from('server_settings').upsert([
          { setting_key: failCountKey, setting_value: '0', updated_at: now }
        ], { onConflict: 'setting_key' })
        console.log('DDNS health: failure counter reset after successful update')
      }
      return
    }

    // Increment failure counter
    const newFailCount = currentFailCount + 1
    await supabase.from('server_settings').upsert([
      { setting_key: failCountKey, setting_value: newFailCount.toString(), updated_at: now }
    ], { onConflict: 'setting_key' })

    console.log(`DDNS health: consecutive failure count = ${newFailCount} (threshold: ${alertThreshold})`)

    // Check if we should send an alert
    if (newFailCount >= alertThreshold && config.email_notifications_enabled === 'true' && config.notification_email) {
      // Don't alert more than once per hour
      const lastAlert = config[lastAlertKey]
      if (lastAlert) {
        const lastAlertTime = new Date(lastAlert).getTime()
        const hourAgo = Date.now() - 60 * 60 * 1000
        if (lastAlertTime > hourAgo) {
          console.log('DDNS health: skipping alert (already sent within last hour)')
          return
        }
      }

      // Record alert timestamp
      await supabase.from('server_settings').upsert([
        { setting_key: lastAlertKey, setting_value: now, updated_at: now }
      ], { onConflict: 'setting_key' })

      // Insert a notification record
      await supabase.from('peer_notifications').insert({
        peer_name: `DDNS: ${hostname}`,
        event_type: 'ddns_failure',
        read: false,
      })

      // Log email alert
      await supabase.from('email_notification_logs').insert({
        peer_name: `DDNS: ${hostname}`,
        event_type: 'ddns_failure_alert',
        recipient_email: config.notification_email,
        subject: `⚠️ DDNS Update Failing: ${hostname}`,
        status: 'sent',
        sent_at: now,
        error_message: `${newFailCount} consecutive failures. Last error: ${errorMessage || 'Unknown'}. Provider: ${provider}`,
      })

      console.log(`DDNS health: ALERT sent to ${config.notification_email} - ${newFailCount} consecutive failures`)
    }
  } catch (healthError) {
    console.error('DDNS health monitoring error:', healthError)
  }
}

// Process a single DDNS update (shared between manual and cron)
async function processDDNSUpdate(
  supabase: ReturnType<typeof createClient>,
  requestBody: DDNSUpdateRequest,
  userId: string | null,
  isServerRequest: boolean
): Promise<Response> {
  // Get DDNS settings from database
  const { data: settings } = await supabase
    .from('server_settings')
    .select('setting_key, setting_value')
    .in('setting_key', [
      'ddns_provider', 'noip_enabled', 'noip_username', 'noip_password',
      'ddns_token', 'noip_hostname', 'ddns_zone_id', 'ddns_custom_url', 'ddns_hostnames'
    ])

  const config: Record<string, string> = {}
  settings?.forEach((s: { setting_key: string; setting_value: string }) => {
    config[s.setting_key] = s.setting_value
  })

  const provider = requestBody.provider || config.ddns_provider || 'noip'
  const hostname = requestBody.hostname || config.noip_hostname

  if (config.noip_enabled !== 'true') {
    return new Response(JSON.stringify({ success: false, message: 'DDNS is disabled' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!hostname) {
    return new Response(JSON.stringify({ success: false, message: 'Hostname not configured' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Get current IP
  let ip = requestBody.ip
  if (!ip) {
    try {
      ip = await getCurrentIP()
    } catch {
      return new Response(JSON.stringify({ success: false, message: 'Failed to detect current IP address' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  let result: DDNSUpdateResponse

  try {
    switch (provider) {
      case 'noip':
        if (!config.noip_username || !config.noip_password) throw new Error('No-IP credentials not configured')
        result = await updateNoIP(hostname, ip, config.noip_username, config.noip_password)
        break
      case 'duckdns':
        if (!config.ddns_token) throw new Error('DuckDNS token not configured')
        result = await updateDuckDNS(hostname, ip, config.ddns_token)
        break
      case 'dynu':
        if (!config.noip_username || !config.noip_password) throw new Error('Dynu credentials not configured')
        result = await updateDynu(hostname, ip, config.noip_username, config.noip_password)
        break
      case 'freedns':
        if (!config.ddns_token) throw new Error('FreeDNS token not configured')
        result = await updateFreeDNS(hostname, ip, config.ddns_token)
        break
      case 'cloudflare':
        if (!config.ddns_token || !config.ddns_zone_id) throw new Error('Cloudflare API token and Zone ID required')
        result = await updateCloudflare(hostname, ip, config.ddns_token, config.ddns_zone_id)
        break
      case 'custom':
        if (!config.ddns_custom_url) throw new Error('Custom update URL not configured')
        result = await updateCustom(hostname, ip, config.noip_username || '', config.noip_password || '', config.ddns_token || '', config.ddns_custom_url)
        break
      default:
        throw new Error(`Unknown provider: ${provider}`)
    }

    const now = new Date().toISOString()
    await supabase.from('server_settings').upsert([
      { setting_key: 'noip_last_update', setting_value: now, updated_at: now },
      { setting_key: 'noip_last_ip', setting_value: ip, updated_at: now },
      { setting_key: 'noip_last_response', setting_value: result.message, updated_at: now }
    ], { onConflict: 'setting_key' })

    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: result.success ? 'DDNS_UPDATE' : 'DDNS_UPDATE_FAILED',
      resource_type: 'ddns',
      details: { provider, hostname, ip, response: result.message, success: result.success, auto: isServerRequest }
    })

    // Health monitoring
    await checkHealthAndAlert(supabase, result.success, provider, hostname, result.success ? undefined : result.message)

    // Also update additional hostnames if this is a cron/auto request
    if (isServerRequest && config.ddns_hostnames) {
      try {
        const additionalHostnames = JSON.parse(config.ddns_hostnames)
        if (Array.isArray(additionalHostnames) && additionalHostnames.length > 0) {
          console.log(`Updating ${additionalHostnames.length} additional hostnames...`)
          for (const entry of additionalHostnames) {
            try {
              // Reuse the same IP for all hostnames
              await processSingleProviderUpdate(supabase, entry.provider || provider, entry.hostname, ip, config, userId, isServerRequest)
            } catch (multiErr) {
              console.error(`Failed to update additional hostname ${entry.hostname}:`, multiErr)
            }
          }
        }
      } catch {
        // Invalid JSON in ddns_hostnames, ignore
      }
    }

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'DDNS_UPDATE_FAILED',
      resource_type: 'ddns',
      details: { provider, hostname, error: errorMessage }
    })

    await checkHealthAndAlert(supabase, false, provider, hostname, errorMessage)

    return new Response(JSON.stringify({ success: false, message: errorMessage, provider }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}

// Update a single hostname with a given provider (for multi-hostname support)
async function processSingleProviderUpdate(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  hostname: string,
  ip: string,
  config: Record<string, string>,
  userId: string | null,
  isAuto: boolean
) {
  let result: DDNSUpdateResponse

  switch (provider) {
    case 'noip':
      result = await updateNoIP(hostname, ip, config.noip_username || '', config.noip_password || '')
      break
    case 'duckdns':
      result = await updateDuckDNS(hostname, ip, config.ddns_token || '')
      break
    case 'dynu':
      result = await updateDynu(hostname, ip, config.noip_username || '', config.noip_password || '')
      break
    case 'freedns':
      result = await updateFreeDNS(hostname, ip, config.ddns_token || '')
      break
    case 'cloudflare':
      result = await updateCloudflare(hostname, ip, config.ddns_token || '', config.ddns_zone_id || '')
      break
    case 'custom':
      result = await updateCustom(hostname, ip, config.noip_username || '', config.noip_password || '', config.ddns_token || '', config.ddns_custom_url || '')
      break
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }

  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: result.success ? 'DDNS_UPDATE' : 'DDNS_UPDATE_FAILED',
    resource_type: 'ddns',
    details: { provider, hostname, ip, response: result.message, success: result.success, auto: isAuto }
  })

  console.log(`Multi-hostname update: ${hostname} (${provider}) -> ${result.success ? 'OK' : 'FAILED'}: ${result.message}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serverToken = Deno.env.get('WIREGUARD_SERVER_TOKEN')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const url = new URL(req.url)
    const path = url.pathname.replace('/ddns-update', '')
    const method = req.method

    // Verify authentication
    const authHeader = req.headers.get('authorization')
    const serverTokenHeader = req.headers.get('x-server-token')

    let userId: string | null = null
    let isAdmin = false
    let isServerRequest = false
    let isCronRequest = false

    // Check for cron/anon key requests (scheduled updates)
    if (path === '/cron' && method === 'POST') {
      // Cron requests use the anon key - we verify it's a valid Supabase request
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
      if (authHeader && authHeader.replace('Bearer ', '') === anonKey) {
        isCronRequest = true
        isAdmin = true
        isServerRequest = true
        console.log('DDNS cron update triggered')
      }
    }

    if (!isCronRequest) {
      if (serverTokenHeader && serverToken && serverTokenHeader === serverToken) {
        isServerRequest = true
        isAdmin = true
      } else if (authHeader) {
        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error } = await supabase.auth.getUser(token)

        if (error || !user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        userId = user.id

        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle()

        isAdmin = !!roleData
      } else {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Cron endpoint
    if (path === '/cron' && method === 'POST') {
      console.log('Processing scheduled DDNS update...')
      return await processDDNSUpdate(supabase, { cron: true }, null, true)
    }

    // Manual update endpoint
    if ((path === '/update' || path === '') && method === 'POST') {
      let requestBody: DDNSUpdateRequest = {}
      try {
        requestBody = await req.json()
      } catch {
        // Body is optional
      }
      return await processDDNSUpdate(supabase, requestBody, userId, isServerRequest)
    }

    // Get providers list
    if (path === '/providers' && method === 'GET') {
      const providers = [
        { id: 'noip', name: 'No-IP', website: 'https://www.noip.com' },
        { id: 'duckdns', name: 'DuckDNS', website: 'https://www.duckdns.org' },
        { id: 'dynu', name: 'Dynu', website: 'https://www.dynu.com' },
        { id: 'freedns', name: 'FreeDNS', website: 'https://freedns.afraid.org' },
        { id: 'cloudflare', name: 'Cloudflare', website: 'https://www.cloudflare.com' },
        { id: 'custom', name: 'Custom Provider', website: '' }
      ]
      return new Response(JSON.stringify({ providers }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Health status endpoint
    if (path === '/health' && method === 'GET') {
      const { data: healthData } = await supabase
        .from('server_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['ddns_consecutive_failures', 'ddns_failure_alert_threshold', 'ddns_last_failure_alert', 'noip_last_update', 'noip_last_ip', 'noip_last_response'])

      const health: Record<string, string> = {}
      healthData?.forEach((s: { setting_key: string; setting_value: string }) => {
        health[s.setting_key] = s.setting_value
      })

      return new Response(JSON.stringify({
        consecutive_failures: parseInt(health.ddns_consecutive_failures || '0'),
        alert_threshold: parseInt(health.ddns_failure_alert_threshold || '3'),
        last_alert: health.ddns_last_failure_alert || null,
        last_update: health.noip_last_update || null,
        last_ip: health.noip_last_ip || null,
        last_response: health.noip_last_response || null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
