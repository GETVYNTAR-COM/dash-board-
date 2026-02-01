export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      agencies: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          email: string;
          plan: 'starter' | 'growth' | 'agency';
          trial_ends_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          email: string;
          plan?: 'starter' | 'growth' | 'agency';
          trial_ends_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          email?: string;
          plan?: 'starter' | 'growth' | 'agency';
          trial_ends_at?: string;
          updated_at?: string;
        };
      };
      clients: {
        Row: {
          id: string;
          agency_id: string;
          business_name: string;
          address: string;
          city: string;
          postcode: string;
          phone: string;
          category: string;
          website: string | null;
          citation_score: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agency_id: string;
          business_name: string;
          address: string;
          city: string;
          postcode: string;
          phone: string;
          category: string;
          website?: string | null;
          citation_score?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agency_id?: string;
          business_name?: string;
          address?: string;
          city?: string;
          postcode?: string;
          phone?: string;
          category?: string;
          website?: string | null;
          citation_score?: number;
          updated_at?: string;
        };
      };
      directories: {
        Row: {
          id: string;
          name: string;
          url: string;
          tier: number;
          domain_authority: number;
          categories: string[];
          automation_level: 'full' | 'semi' | 'manual';
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          url: string;
          tier?: number;
          domain_authority?: number;
          categories?: string[];
          automation_level?: 'full' | 'semi' | 'manual';
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          url?: string;
          tier?: number;
          domain_authority?: number;
          categories?: string[];
          automation_level?: 'full' | 'semi' | 'manual';
        };
      };
      citations: {
        Row: {
          id: string;
          client_id: string;
          directory_id: string;
          status: 'pending' | 'submitted' | 'live' | 'error';
          nap_consistent: boolean;
          submitted_at: string | null;
          live_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          directory_id: string;
          status?: 'pending' | 'submitted' | 'live' | 'error';
          nap_consistent?: boolean;
          submitted_at?: string | null;
          live_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          directory_id?: string;
          status?: 'pending' | 'submitted' | 'live' | 'error';
          nap_consistent?: boolean;
          submitted_at?: string | null;
          live_at?: string | null;
        };
      };
      reports: {
        Row: {
          id: string;
          client_id: string;
          report_type: 'citation_audit' | 'competitor_analysis' | 'monthly_report';
          summary: string;
          insights: Json;
          recommendations: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          report_type: 'citation_audit' | 'competitor_analysis' | 'monthly_report';
          summary: string;
          insights?: Json;
          recommendations?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          report_type?: 'citation_audit' | 'competitor_analysis' | 'monthly_report';
          summary?: string;
          insights?: Json;
          recommendations?: Json;
        };
      };
      competitors: {
        Row: {
          id: string;
          client_id: string;
          business_name: string;
          citation_count: number;
          citation_score: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          business_name: string;
          citation_count?: number;
          citation_score?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          business_name?: string;
          citation_count?: number;
          citation_score?: number;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}

export type Agency = Database['public']['Tables']['agencies']['Row'];
export type Client = Database['public']['Tables']['clients']['Row'];
export type Directory = Database['public']['Tables']['directories']['Row'];
export type Citation = Database['public']['Tables']['citations']['Row'];
export type Report = Database['public']['Tables']['reports']['Row'];
export type Competitor = Database['public']['Tables']['competitors']['Row'];
