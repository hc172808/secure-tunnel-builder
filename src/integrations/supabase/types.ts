export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      firewall_rules: {
        Row: {
          action: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          destination_ip: string | null
          enabled: boolean | null
          id: string
          name: string
          port: string | null
          priority: number | null
          protocol: string | null
          source_ip: string | null
          updated_at: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          destination_ip?: string | null
          enabled?: boolean | null
          id?: string
          name: string
          port?: string | null
          priority?: number | null
          protocol?: string | null
          source_ip?: string | null
          updated_at?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          destination_ip?: string | null
          enabled?: boolean | null
          id?: string
          name?: string
          port?: string | null
          priority?: number | null
          protocol?: string | null
          source_ip?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      peer_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          peer_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          peer_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          peer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "peer_assignments_peer_id_fkey"
            columns: ["peer_id"]
            isOneToOne: false
            referencedRelation: "wireguard_peers"
            referencedColumns: ["id"]
          },
        ]
      }
      peer_notifications: {
        Row: {
          created_at: string
          event_type: string
          id: string
          peer_id: string | null
          peer_name: string
          read: boolean
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          peer_id?: string | null
          peer_name: string
          read?: boolean
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          peer_id?: string | null
          peer_name?: string
          read?: boolean
        }
        Relationships: []
      }
      pending_peer_requests: {
        Row: {
          allowed_ips: string
          approved_by: string | null
          created_at: string
          id: string
          name: string
          public_key: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_ips?: string
          approved_by?: string | null
          created_at?: string
          id?: string
          name: string
          public_key?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_ips?: string
          approved_by?: string | null
          created_at?: string
          id?: string
          name?: string
          public_key?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          api_token: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_disabled: boolean | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          api_token?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_disabled?: boolean | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          api_token?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_disabled?: boolean | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      server_settings: {
        Row: {
          description: string | null
          id: string
          setting_key: string
          setting_value: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description?: string | null
          id?: string
          setting_key: string
          setting_value: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string | null
          id?: string
          setting_key?: string
          setting_value?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      traffic_stats: {
        Row: {
          id: string
          peer_id: string
          recorded_at: string
          rx_bytes: number
          tx_bytes: number
        }
        Insert: {
          id?: string
          peer_id: string
          recorded_at?: string
          rx_bytes?: number
          tx_bytes?: number
        }
        Update: {
          id?: string
          peer_id?: string
          recorded_at?: string
          rx_bytes?: number
          tx_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "traffic_stats_peer_id_fkey"
            columns: ["peer_id"]
            isOneToOne: false
            referencedRelation: "wireguard_peers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wireguard_peers: {
        Row: {
          allowed_ips: string
          created_at: string
          created_by: string | null
          dns: string | null
          endpoint: string | null
          id: string
          last_handshake: string | null
          name: string
          persistent_keepalive: number | null
          private_key: string | null
          public_key: string
          status: string
          transfer_rx: number | null
          transfer_tx: number | null
          updated_at: string
        }
        Insert: {
          allowed_ips?: string
          created_at?: string
          created_by?: string | null
          dns?: string | null
          endpoint?: string | null
          id?: string
          last_handshake?: string | null
          name: string
          persistent_keepalive?: number | null
          private_key?: string | null
          public_key: string
          status?: string
          transfer_rx?: number | null
          transfer_tx?: number | null
          updated_at?: string
        }
        Update: {
          allowed_ips?: string
          created_at?: string
          created_by?: string | null
          dns?: string | null
          endpoint?: string | null
          id?: string
          last_handshake?: string | null
          name?: string
          persistent_keepalive?: number | null
          private_key?: string | null
          public_key?: string
          status?: string
          transfer_rx?: number | null
          transfer_tx?: number | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
