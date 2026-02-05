 import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
 
 const corsHeaders = {
   'Access-Control-Allow-Origin': '*',
   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-server-token',
   'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
 }
 
 interface DDNSUpdateRequest {
   provider?: string
   hostname?: string
   ip?: string
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
 
 async function updateNoIP(
   hostname: string,
   ip: string,
   username: string,
   password: string
 ): Promise<DDNSUpdateResponse> {
   const auth = btoa(`${username}:${password}`)
   const url = `https://dynupdate.no-ip.com/nic/update?hostname=${encodeURIComponent(hostname)}&myip=${encodeURIComponent(ip)}`
   
   const response = await fetch(url, {
     method: 'GET',
     headers: {
       'Authorization': `Basic ${auth}`,
       'User-Agent': 'WireGuard-Manager/1.0 admin@wireguard-manager.local'
     }
   })
   
   const responseText = await response.text()
   const responseCode = responseText.split(' ')[0].toLowerCase()
   
   const result = NOIP_RESPONSE_CODES[responseCode] || { 
     success: false, 
     message: `Unknown response: ${responseText}` 
   }
   
   return {
     success: result.success,
     message: result.message,
     ip,
     hostname,
     provider: 'noip',
     response_code: responseCode
   }
 }
 
 async function updateDuckDNS(
   hostname: string,
   ip: string,
   token: string
 ): Promise<DDNSUpdateResponse> {
   // Extract subdomain from full hostname
   const subdomain = hostname.replace('.duckdns.org', '')
   const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(subdomain)}&token=${encodeURIComponent(token)}&ip=${encodeURIComponent(ip)}`
   
   const response = await fetch(url)
   const responseText = (await response.text()).trim().toLowerCase()
   
   const result = DUCKDNS_RESPONSE_CODES[responseText] || { 
     success: false, 
     message: `Unknown response: ${responseText}` 
   }
   
   return {
     success: result.success,
     message: result.message,
     ip,
     hostname,
     provider: 'duckdns',
     response_code: responseText
   }
 }
 
 async function updateDynu(
   hostname: string,
   ip: string,
   username: string,
   password: string
 ): Promise<DDNSUpdateResponse> {
   const auth = btoa(`${username}:${password}`)
   const url = `https://api.dynu.com/nic/update?hostname=${encodeURIComponent(hostname)}&myip=${encodeURIComponent(ip)}`
   
   const response = await fetch(url, {
     method: 'GET',
     headers: {
       'Authorization': `Basic ${auth}`,
       'User-Agent': 'WireGuard-Manager/1.0'
     }
   })
   
   const responseText = await response.text()
   const responseCode = responseText.split(' ')[0].toLowerCase()
   
   // Dynu uses similar response codes to No-IP
   const result = NOIP_RESPONSE_CODES[responseCode] || { 
     success: responseText.toLowerCase().includes('good') || responseText.toLowerCase().includes('nochg'),
     message: responseText
   }
   
   return {
     success: result.success,
     message: result.message,
     ip,
     hostname,
     provider: 'dynu',
     response_code: responseCode
   }
 }
 
 async function updateFreeDNS(
   hostname: string,
   ip: string,
   token: string
 ): Promise<DDNSUpdateResponse> {
   const url = `https://freedns.afraid.org/dynamic/update.php?${token}&address=${encodeURIComponent(ip)}`
   
   const response = await fetch(url)
   const responseText = await response.text()
   
   const success = responseText.toLowerCase().includes('updated') || 
                   responseText.toLowerCase().includes('no ip change')
   
   return {
     success,
     message: success ? 'IP updated successfully' : responseText,
     ip,
     hostname,
     provider: 'freedns',
     response_code: success ? 'ok' : 'error'
   }
 }
 
 async function updateCloudflare(
   hostname: string,
   ip: string,
   token: string,
   zoneId: string
 ): Promise<DDNSUpdateResponse> {
   // First, get the DNS record ID
   const listUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}&type=A`
   
   const listResponse = await fetch(listUrl, {
     headers: {
       'Authorization': `Bearer ${token}`,
       'Content-Type': 'application/json'
     }
   })
   
   const listData = await listResponse.json()
   
   if (!listData.success || !listData.result || listData.result.length === 0) {
     return {
       success: false,
       message: 'DNS record not found. Create an A record first in Cloudflare.',
       ip,
       hostname,
       provider: 'cloudflare',
       response_code: 'not_found'
     }
   }
   
   const recordId = listData.result[0].id
   
   // Update the record
   const updateUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`
   
   const updateResponse = await fetch(updateUrl, {
     method: 'PATCH',
     headers: {
       'Authorization': `Bearer ${token}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({
       content: ip,
       ttl: 1 // Auto TTL
     })
   })
   
   const updateData = await updateResponse.json()
   
   return {
     success: updateData.success,
     message: updateData.success ? 'IP updated successfully' : (updateData.errors?.[0]?.message || 'Update failed'),
     ip,
     hostname,
     provider: 'cloudflare',
     response_code: updateData.success ? 'ok' : 'error'
   }
 }
 
 async function updateCustom(
   hostname: string,
   ip: string,
   username: string,
   password: string,
   token: string,
   customUrl: string
 ): Promise<DDNSUpdateResponse> {
   // Replace variables in custom URL
   let url = customUrl
     .replace('{hostname}', encodeURIComponent(hostname))
     .replace('{ip}', encodeURIComponent(ip))
     .replace('{username}', encodeURIComponent(username))
     .replace('{password}', encodeURIComponent(password))
     .replace('{token}', encodeURIComponent(token))
   
   const headers: Record<string, string> = {
     'User-Agent': 'WireGuard-Manager/1.0'
   }
   
   if (username && password) {
     headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`
   }
   
   const response = await fetch(url, { headers })
   const responseText = await response.text()
   
   const success = response.ok || 
                   responseText.toLowerCase().includes('good') ||
                   responseText.toLowerCase().includes('ok') ||
                   responseText.toLowerCase().includes('updated')
   
   return {
     success,
     message: success ? 'IP updated successfully' : responseText,
     ip,
     hostname,
     provider: 'custom',
     response_code: success ? 'ok' : 'error'
   }
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
     const path = url.pathname.replace('/ddns-update', '')
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
         .maybeSingle()
       
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
 
     // Update DDNS record
     if ((path === '/update' || path === '') && method === 'POST') {
       let requestBody: DDNSUpdateRequest = {}
       try {
         requestBody = await req.json()
       } catch {
         // Body is optional
       }
 
       // Get DDNS settings from database
       const { data: settings } = await supabase
         .from('server_settings')
         .select('setting_key, setting_value')
         .in('setting_key', [
           'ddns_provider',
           'noip_enabled',
           'noip_username',
           'noip_password',
           'ddns_token',
           'noip_hostname',
           'ddns_zone_id',
           'ddns_custom_url'
         ])
 
       const config: Record<string, string> = {}
       settings?.forEach(s => {
         config[s.setting_key] = s.setting_value
       })
 
       const provider = requestBody.provider || config.ddns_provider || 'noip'
       const hostname = requestBody.hostname || config.noip_hostname
       
       if (config.noip_enabled !== 'true') {
         return new Response(JSON.stringify({ 
           success: false, 
           message: 'DDNS is disabled' 
         }), {
           status: 400,
           headers: { ...corsHeaders, 'Content-Type': 'application/json' }
         })
       }
 
       if (!hostname) {
         return new Response(JSON.stringify({ 
           success: false, 
           message: 'Hostname not configured' 
         }), {
           status: 400,
           headers: { ...corsHeaders, 'Content-Type': 'application/json' }
         })
       }
 
       // Get current IP
       let ip = requestBody.ip
       if (!ip) {
         try {
           ip = await getCurrentIP()
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
 
       let result: DDNSUpdateResponse
 
       try {
         switch (provider) {
           case 'noip':
             if (!config.noip_username || !config.noip_password) {
               throw new Error('No-IP credentials not configured')
             }
             result = await updateNoIP(hostname, ip, config.noip_username, config.noip_password)
             break
             
           case 'duckdns':
             if (!config.ddns_token) {
               throw new Error('DuckDNS token not configured')
             }
             result = await updateDuckDNS(hostname, ip, config.ddns_token)
             break
             
           case 'dynu':
             if (!config.noip_username || !config.noip_password) {
               throw new Error('Dynu credentials not configured')
             }
             result = await updateDynu(hostname, ip, config.noip_username, config.noip_password)
             break
             
           case 'freedns':
             if (!config.ddns_token) {
               throw new Error('FreeDNS token not configured')
             }
             result = await updateFreeDNS(hostname, ip, config.ddns_token)
             break
             
           case 'cloudflare':
             if (!config.ddns_token || !config.ddns_zone_id) {
               throw new Error('Cloudflare API token and Zone ID required')
             }
             result = await updateCloudflare(hostname, ip, config.ddns_token, config.ddns_zone_id)
             break
             
           case 'custom':
             if (!config.ddns_custom_url) {
               throw new Error('Custom update URL not configured')
             }
             result = await updateCustom(
               hostname, 
               ip, 
               config.noip_username || '',
               config.noip_password || '',
               config.ddns_token || '',
               config.ddns_custom_url
             )
             break
             
           default:
             throw new Error(`Unknown provider: ${provider}`)
         }
 
         // Update last update timestamp and IP in database
         const now = new Date().toISOString()
         
         await supabase.from('server_settings').upsert([
           { setting_key: 'noip_last_update', setting_value: now, updated_at: now },
           { setting_key: 'noip_last_ip', setting_value: ip, updated_at: now },
           { setting_key: 'noip_last_response', setting_value: result.message, updated_at: now }
         ], { onConflict: 'setting_key' })
 
         // Log the update
         await supabase.from('audit_logs').insert({
           user_id: userId,
           action: 'DDNS_UPDATE',
           resource_type: 'ddns',
           details: {
             provider,
             hostname,
             ip,
             response: result.message,
             success: result.success,
             auto: isServerRequest
           }
         })
 
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
 
         return new Response(JSON.stringify({ 
           success: false, 
           message: errorMessage,
           provider
         }), {
           status: 500,
           headers: { ...corsHeaders, 'Content-Type': 'application/json' }
         })
       }
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