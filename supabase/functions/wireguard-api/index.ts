import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-server-token',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

interface WireGuardPeer {
  name: string
  public_key: string
  private_key?: string
  allowed_ips: string
  endpoint?: string
  dns?: string
  persistent_keepalive?: number
}

interface ServerStatus {
  is_running: boolean
  public_key: string
  endpoint: string
  listen_port: number
  uptime: string
  peers: PeerStatus[]
}

interface PeerStatus {
  public_key: string
  allowed_ips: string
  latest_handshake: number
  transfer_rx: number
  transfer_tx: number
  endpoint: string
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
    const path = url.pathname.replace('/wireguard-api', '')
    const method = req.method

    // Verify authentication - either Supabase auth or server token for local server
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

    // Routes
    if (path === '/status' && method === 'GET') {
      // Get server status - called by local WireGuard server to sync
      const { data: settings } = await supabase
        .from('server_settings')
        .select('*')
      
      const { data: peers } = await supabase
        .from('wireguard_peers')
        .select('*')
      
      return new Response(JSON.stringify({
        settings: settings?.reduce((acc, s) => ({ ...acc, [s.setting_key]: s.setting_value }), {}),
        peers: peers || []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (path === '/sync-status' && method === 'POST') {
      // Server pushes live status data
      if (!isServerRequest) {
        return new Response(JSON.stringify({ error: 'Server token required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const body = await req.json() as ServerStatus
      
      // Update server settings
      const settingsToUpdate = [
        { key: 'is_running', value: String(body.is_running) },
        { key: 'public_key', value: body.public_key },
        { key: 'endpoint', value: body.endpoint },
        { key: 'listen_port', value: String(body.listen_port) },
        { key: 'uptime', value: body.uptime },
      ]

      for (const setting of settingsToUpdate) {
        await supabase
          .from('server_settings')
          .upsert({ 
            setting_key: setting.key, 
            setting_value: setting.value,
            updated_at: new Date().toISOString()
          }, { onConflict: 'setting_key' })
      }

      // Update peer statuses
      for (const peer of body.peers) {
        const { data: existingPeer } = await supabase
          .from('wireguard_peers')
          .select('id')
          .eq('public_key', peer.public_key)
          .single()

        if (existingPeer) {
          await supabase
            .from('wireguard_peers')
            .update({
              status: peer.latest_handshake > 0 ? 'connected' : 'disconnected',
              last_handshake: peer.latest_handshake > 0 
                ? new Date(peer.latest_handshake * 1000).toISOString() 
                : null,
              transfer_rx: peer.transfer_rx,
              transfer_tx: peer.transfer_tx,
              endpoint: peer.endpoint || null,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingPeer.id)

          // Record traffic stats
          await supabase
            .from('traffic_stats')
            .insert({
              peer_id: existingPeer.id,
              rx_bytes: peer.transfer_rx,
              tx_bytes: peer.transfer_tx
            })
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (path === '/peers' && method === 'GET') {
      // List peers
      let query = supabase.from('wireguard_peers').select('*')
      
      if (!isAdmin && userId) {
        const { data: assignments } = await supabase
          .from('peer_assignments')
          .select('peer_id')
          .eq('user_id', userId)
        
        const peerIds = assignments?.map(a => a.peer_id) || []
        if (peerIds.length === 0) {
          return new Response(JSON.stringify([]), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        query = query.in('id', peerIds)
      }

      const { data, error } = await query

      if (error) throw error

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (path === '/peers' && method === 'POST') {
      // Create peer
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Admin required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const body = await req.json() as WireGuardPeer

      // Check if auto-subdomain assignment is enabled
      let subdomain: string | null = null
      let hostname: string | null = null
      
      const { data: domainSettings } = await supabase
        .from('server_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['node_domain_enabled', 'node_base_domain'])
      
      const domainConfig: Record<string, string> = {}
      domainSettings?.forEach(s => {
        domainConfig[s.setting_key] = s.setting_value
      })
      
      if (domainConfig.node_domain_enabled === 'true' && domainConfig.node_base_domain) {
        // Generate subdomain from peer name
        subdomain = body.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
        
        hostname = `${subdomain}.${domainConfig.node_base_domain}`
      }

      const { data, error } = await supabase
        .from('wireguard_peers')
        .insert({
          name: body.name,
          public_key: body.public_key,
          private_key: body.private_key,
          allowed_ips: body.allowed_ips,
          dns: body.dns || '1.1.1.1',
          persistent_keepalive: body.persistent_keepalive || 25,
          created_by: userId,
          subdomain,
          hostname
        })
        .select()
        .single()

      if (error) throw error

      // Log action
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'create',
        resource_type: 'peer',
        resource_id: data.id,
        details: { name: body.name, subdomain, hostname }
      })
      
      // Create notification for new peer
      await supabase.from('peer_notifications').insert({
        peer_id: data.id,
        peer_name: body.name,
        event_type: 'peer_created'
      })

      return new Response(JSON.stringify(data), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (path.match(/^\/peers\/[\w-]+$/) && method === 'DELETE') {
      // Delete peer
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Admin required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const peerId = path.split('/')[2]

      const { data: peer } = await supabase
        .from('wireguard_peers')
        .select('name')
        .eq('id', peerId)
        .single()

      const { error } = await supabase
        .from('wireguard_peers')
        .delete()
        .eq('id', peerId)

      if (error) throw error

      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'delete',
        resource_type: 'peer',
        resource_id: peerId,
        details: { name: peer?.name }
      })

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (path.match(/^\/peers\/[\w-]+$/) && method === 'PUT') {
      // Update peer
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Admin required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const peerId = path.split('/')[2]
      const body = await req.json()

      const { data, error } = await supabase
        .from('wireguard_peers')
        .update(body)
        .eq('id', peerId)
        .select()
        .single()

      if (error) throw error

      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'update',
        resource_type: 'peer',
        resource_id: peerId,
        details: body
      })

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (path === '/traffic-stats' && method === 'GET') {
      const peerId = url.searchParams.get('peer_id')
      const hours = parseInt(url.searchParams.get('hours') || '24')
      
      let query = supabase
        .from('traffic_stats')
        .select('*')
        .gte('recorded_at', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString())
        .order('recorded_at', { ascending: true })

      if (peerId) {
        query = query.eq('peer_id', peerId)
      }

      const { data, error } = await query

      if (error) throw error

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (path === '/backup' && method === 'GET') {
      if (!isAdmin && !isServerRequest) {
        return new Response(JSON.stringify({ error: 'Admin required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Export all data for backup
      const { data: peers } = await supabase.from('wireguard_peers').select('*')
      const { data: settings } = await supabase.from('server_settings').select('*')
      const { data: assignments } = await supabase.from('peer_assignments').select('*')
      const { data: roles } = await supabase.from('user_roles').select('*')
      const { data: profiles } = await supabase.from('profiles').select('*')

      const backup = {
        version: '1.0',
        created_at: new Date().toISOString(),
        data: {
          wireguard_peers: peers,
          server_settings: settings,
          peer_assignments: assignments,
          user_roles: roles,
          profiles: profiles
        }
      }

      return new Response(JSON.stringify(backup, null, 2), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="wireguard-backup-${new Date().toISOString().split('T')[0]}.json"`
        }
      })
    }

    if (path === '/restore' && method === 'POST') {
      if (!isAdmin && !isServerRequest) {
        return new Response(JSON.stringify({ error: 'Admin required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const backup = await req.json()

      if (!backup.version || !backup.data) {
        return new Response(JSON.stringify({ error: 'Invalid backup format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Restore data
      if (backup.data.server_settings?.length) {
        for (const setting of backup.data.server_settings) {
          await supabase
            .from('server_settings')
            .upsert(setting, { onConflict: 'setting_key' })
        }
      }

      if (backup.data.wireguard_peers?.length) {
        for (const peer of backup.data.wireguard_peers) {
          await supabase
            .from('wireguard_peers')
            .upsert(peer, { onConflict: 'id' })
        }
      }

      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'restore',
        resource_type: 'database',
        details: { 
          peers_count: backup.data.wireguard_peers?.length,
          settings_count: backup.data.server_settings?.length
        }
      })

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Peer request via API token (for scripts)
    if (path === '/peer-request' && method === 'POST') {
      const apiToken = req.headers.get('x-api-token')
      
      if (!apiToken) {
        return new Response(JSON.stringify({ error: 'API token required' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Find user by API token
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('api_token', apiToken)
        .single()

      if (!profile) {
        return new Response(JSON.stringify({ error: 'Invalid API token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const body = await req.json()

      const { data, error } = await supabase
        .from('pending_peer_requests')
        .insert({
          user_id: profile.user_id,
          name: body.name,
          public_key: body.public_key,
          allowed_ips: body.allowed_ips || '10.0.0.0/24',
        })
        .select()
        .single()

      if (error) throw error

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Peer request submitted. Waiting for admin approval.',
        request_id: data.id 
      }), {
        status: 201,
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
