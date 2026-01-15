import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

interface DnsValidationResult {
  hostname: string
  valid: boolean
  resolved_ips: string[]
  expected_ip: string | null
  error: string | null
  response_time_ms: number
}

async function resolveDns(hostname: string): Promise<{ ips: string[]; error: string | null }> {
  try {
    // Use Cloudflare DNS-over-HTTPS for DNS resolution
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      {
        headers: {
          'Accept': 'application/dns-json'
        }
      }
    )

    if (!response.ok) {
      return { ips: [], error: `DNS query failed: ${response.status}` }
    }

    const data = await response.json()
    
    if (data.Status !== 0) {
      // DNS status codes: 0 = NOERROR, 3 = NXDOMAIN
      const statusMessages: Record<number, string> = {
        1: 'Format error',
        2: 'Server failure',
        3: 'Domain does not exist (NXDOMAIN)',
        4: 'Not implemented',
        5: 'Refused'
      }
      return { ips: [], error: statusMessages[data.Status] || `DNS error: ${data.Status}` }
    }

    if (!data.Answer || data.Answer.length === 0) {
      return { ips: [], error: 'No DNS records found' }
    }

    const ips = data.Answer
      .filter((record: { type: number }) => record.type === 1) // Type 1 = A record
      .map((record: { data: string }) => record.data)

    return { ips, error: null }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { ips: [], error: `DNS resolution failed: ${errorMessage}` }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify authentication
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single()
    
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const url = new URL(req.url)
    const path = url.pathname.replace('/dns-validate', '')

    // Validate a single hostname
    if (path === '/check' && req.method === 'POST') {
      const { hostname, expected_ip } = await req.json()

      if (!hostname) {
        return new Response(JSON.stringify({ error: 'Hostname is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const startTime = Date.now()
      const { ips, error } = await resolveDns(hostname)
      const responseTime = Date.now() - startTime

      const result: DnsValidationResult = {
        hostname,
        valid: ips.length > 0 && !error,
        resolved_ips: ips,
        expected_ip: expected_ip || null,
        error,
        response_time_ms: responseTime
      }

      // Check if resolved IP matches expected IP
      if (expected_ip && ips.length > 0) {
        result.valid = ips.includes(expected_ip)
        if (!result.valid) {
          result.error = `IP mismatch: expected ${expected_ip}, got ${ips.join(', ')}`
        }
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate all peer subdomains
    if (path === '/check-all' && req.method === 'GET') {
      // Get server endpoint for expected IP
      const { data: serverSettings } = await supabase
        .from('server_settings')
        .select('setting_key, setting_value')
        .eq('setting_key', 'endpoint')
        .single()
      
      const serverEndpoint = serverSettings?.setting_value || null
      // Extract IP from endpoint (format could be IP:port or just IP)
      const expectedIp = serverEndpoint?.split(':')[0] || null

      // Get all peers with hostnames
      const { data: peers } = await supabase
        .from('wireguard_peers')
        .select('id, name, hostname, subdomain')
        .not('hostname', 'is', null)

      if (!peers || peers.length === 0) {
        return new Response(JSON.stringify({ 
          message: 'No peers with assigned hostnames',
          results: []
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const results: (DnsValidationResult & { peer_id: string; peer_name: string })[] = []

      for (const peer of peers) {
        if (!peer.hostname) continue

        const startTime = Date.now()
        const { ips, error } = await resolveDns(peer.hostname)
        const responseTime = Date.now() - startTime

        const result = {
          peer_id: peer.id,
          peer_name: peer.name,
          hostname: peer.hostname,
          valid: ips.length > 0 && !error,
          resolved_ips: ips,
          expected_ip: expectedIp,
          error,
          response_time_ms: responseTime
        }

        // Check if resolved IP matches expected IP
        if (expectedIp && ips.length > 0) {
          result.valid = ips.includes(expectedIp)
          if (!result.valid) {
            result.error = `IP mismatch: expected ${expectedIp}, got ${ips.join(', ')}`
          }
        }

        results.push(result)
      }

      return new Response(JSON.stringify({
        expected_ip: expectedIp,
        total: results.length,
        valid_count: results.filter(r => r.valid).length,
        invalid_count: results.filter(r => !r.valid).length,
        results
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate before assignment
    if (path === '/pre-check' && req.method === 'POST') {
      const { subdomain, base_domain, expected_ip } = await req.json()

      if (!subdomain || !base_domain) {
        return new Response(JSON.stringify({ error: 'Subdomain and base_domain are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const hostname = `${subdomain}.${base_domain}`
      
      // Check if wildcard DNS is configured
      const wildcardHostname = `*.${base_domain}`
      const testHostname = `_lovable-test-${Date.now()}.${base_domain}`
      
      const startTime = Date.now()
      const { ips, error } = await resolveDns(testHostname)
      const responseTime = Date.now() - startTime

      const result = {
        hostname,
        wildcard_configured: ips.length > 0,
        resolved_ips: ips,
        expected_ip: expected_ip || null,
        valid: ips.length > 0,
        error: ips.length === 0 ? 'Wildcard DNS not configured for base domain' : null,
        response_time_ms: responseTime,
        recommendation: ips.length === 0 
          ? `Configure a wildcard A record: *.${base_domain} → ${expected_ip || 'your-server-ip'}`
          : 'Wildcard DNS is properly configured'
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('DNS validation error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
