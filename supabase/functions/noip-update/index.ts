import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-server-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

interface NoIPUpdateRequest {
  hostname?: string
  ip?: string
}

interface NoIPUpdateResponse {
  success: boolean
  message: string
  ip?: string
  hostname?: string
  response_code?: string
}

// NoIP API response codes
const NOIP_RESPONSE_CODES: Record<string, { success: boolean; message: string }> = {
  'good': { success: true, message: 'IP address updated successfully' },
  'nochg': { success: true, message: 'IP address has not changed' },
  'nohost': { success: false, message: 'Hostname not found in your account' },
  'badauth': { success: false, message: 'Invalid username/password' },
  'badagent': { success: false, message: 'Client blocked by No-IP' },
  '!donator': { success: false, message: 'Feature not available for free accounts' },
  'abuse': { success: false, message: 'Hostname blocked due to abuse' },
  '911': { success: false, message: 'No-IP server error, retry later' },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serverToken = Deno.env.get('WIREGUARD_SERVER_TOKEN')
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    const url = new URL(req.url)
    const path = url.pathname.replace('/noip-update', '')
    const method = req.method

    // Verify authentication
    const authHeader = req.headers.get('authorization')
    const serverTokenHeader = req.headers.get('x-server-token')
    
    let userId: string | null = null
    let isAdmin = false
    let isServerRequest = false

    if (serverTokenHeader && serverToken && serverTokenHeader === serverToken) {
      isServerRequest = true
      isAdmin = true
    } else if (authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error } = await supabase.auth.getUser(token)
      
      if (error || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      userId = user.id
      
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .single()
      
      isAdmin = !!roleData
    } else {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get current public IP
    if (path === '/current-ip' && method === 'GET') {
      try {
        const ipResponse = await fetch('https://api.ipify.org?format=json')
        const ipData = await ipResponse.json()
        
        return new Response(JSON.stringify({ ip: ipData.ip }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } catch (error) {
        // Try alternative IP service
        try {
          const altResponse = await fetch('https://ifconfig.me/ip')
          const ip = await altResponse.text()
          return new Response(JSON.stringify({ ip: ip.trim() }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        } catch {
          return new Response(JSON.stringify({ error: 'Failed to get current IP' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
      }
    }

    // Update No-IP DNS record
    if ((path === '/update' || path === '') && method === 'POST') {
      // Get No-IP settings from database
      const { data: settings } = await supabase
        .from('server_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['noip_username', 'noip_password', 'noip_hostname', 'noip_enabled'])

      const noipSettings: Record<string, string> = {}
      settings?.forEach(s => {
        noipSettings[s.setting_key] = s.setting_value
      })

      if (noipSettings.noip_enabled !== 'true') {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'No-IP integration is disabled' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (!noipSettings.noip_username || !noipSettings.noip_password || !noipSettings.noip_hostname) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: 'No-IP credentials not configured' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Parse request body for optional hostname/IP override
      let requestBody: NoIPUpdateRequest = {}
      try {
        requestBody = await req.json()
      } catch {
        // Body is optional
      }

      const hostname = requestBody.hostname || noipSettings.noip_hostname
      let myip = requestBody.ip

      // Get current IP if not provided
      if (!myip) {
        try {
          const ipResponse = await fetch('https://api.ipify.org?format=json')
          const ipData = await ipResponse.json()
          myip = ipData.ip
        } catch {
          try {
            const altResponse = await fetch('https://ifconfig.me/ip')
            myip = (await altResponse.text()).trim()
          } catch {
            return new Response(JSON.stringify({ 
              success: false, 
              message: 'Failed to detect current IP address' 
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
          }
        }
      }

      // Ensure myip is a string at this point
      const ipAddress: string = myip as string

      // Create Basic Auth header
      const auth = btoa(`${noipSettings.noip_username}:${noipSettings.noip_password}`)

      // Call No-IP Dynamic Update API
      // https://www.noip.com/integrate/request
      const noipUrl = `https://dynupdate.no-ip.com/nic/update?hostname=${encodeURIComponent(hostname)}&myip=${encodeURIComponent(ipAddress)}`

      try {
        const noipResponse = await fetch(noipUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
            'User-Agent': 'WireGuard-Manager/1.0 admin@wireguard-manager.local'
          }
        })

        const responseText = await noipResponse.text()
        const responseCode = responseText.split(' ')[0].toLowerCase()

        const result = NOIP_RESPONSE_CODES[responseCode] || { 
          success: false, 
          message: `Unknown response: ${responseText}` 
        }

        // Update last update timestamp and IP in database
        const now = new Date().toISOString()
        
        await supabase.from('server_settings').upsert([
          { setting_key: 'noip_last_update', setting_value: now, updated_at: now },
          { setting_key: 'noip_last_ip', setting_value: ipAddress, updated_at: now },
          { setting_key: 'noip_last_response', setting_value: responseText, updated_at: now }
        ], { onConflict: 'setting_key' })

        // Log the update
        await supabase.from('audit_logs').insert({
          user_id: userId,
          action: 'NOIP_UPDATE',
          resource_type: 'noip_dns',
          details: {
            hostname,
            ip: ipAddress,
            response: responseText,
            success: result.success,
            auto: isServerRequest
          }
        })

        const response: NoIPUpdateResponse = {
          success: result.success,
          message: result.message,
          ip: ipAddress,
          hostname,
          response_code: responseCode
        }

        return new Response(JSON.stringify(response), {
          status: result.success ? 200 : 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        
        await supabase.from('audit_logs').insert({
          user_id: userId,
          action: 'NOIP_UPDATE_FAILED',
          resource_type: 'noip_dns',
          details: { hostname, error: errorMessage }
        })

        return new Response(JSON.stringify({ 
          success: false, 
          message: `Failed to update No-IP: ${errorMessage}` 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // Get No-IP status
    if (path === '/status' && method === 'GET') {
      const { data: settings } = await supabase
        .from('server_settings')
        .select('setting_key, setting_value')
        .in('setting_key', [
          'noip_enabled',
          'noip_hostname',
          'noip_last_update',
          'noip_last_ip',
          'noip_last_response',
          'noip_update_interval',
          'noip_auto_update_enabled',
          'noip_next_update'
        ])

      const status: Record<string, string | null> = {}
      settings?.forEach(s => {
        status[s.setting_key.replace('noip_', '')] = s.setting_value
      })

      // Get current IP
      let currentIp = null
      try {
        const ipResponse = await fetch('https://api.ipify.org?format=json')
        const ipData = await ipResponse.json()
        currentIp = ipData.ip
      } catch {
        // Ignore
      }

      return new Response(JSON.stringify({
        ...status,
        current_ip: currentIp,
        ip_changed: currentIp && status.last_ip && currentIp !== status.last_ip
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
