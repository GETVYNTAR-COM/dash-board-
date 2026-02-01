-- VYNTAR Local SEO - Database Schema
-- Run this migration against your Supabase project

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- AGENCIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'growth', 'agency')),
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agencies_user_id ON agencies(user_id);

-- ============================================================
-- CLIENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postcode TEXT NOT NULL,
  phone TEXT NOT NULL,
  category TEXT NOT NULL,
  website TEXT,
  citation_score INTEGER DEFAULT 0 CHECK (citation_score >= 0 AND citation_score <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_agency_id ON clients(agency_id);

-- ============================================================
-- DIRECTORIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS directories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1 CHECK (tier >= 1 AND tier <= 4),
  domain_authority INTEGER DEFAULT 0,
  categories TEXT[] DEFAULT '{}',
  automation_level TEXT DEFAULT 'manual' CHECK (automation_level IN ('full', 'semi', 'manual')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_directories_tier ON directories(tier);

-- ============================================================
-- CITATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS citations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  directory_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'live', 'error')),
  nap_consistent BOOLEAN DEFAULT true,
  submitted_at TIMESTAMPTZ,
  live_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, directory_id)
);

CREATE INDEX idx_citations_client_id ON citations(client_id);
CREATE INDEX idx_citations_directory_id ON citations(directory_id);
CREATE INDEX idx_citations_status ON citations(status);

-- ============================================================
-- REPORTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('citation_audit', 'competitor_analysis', 'monthly_report')),
  summary TEXT NOT NULL,
  insights JSONB DEFAULT '{}',
  recommendations JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_client_id ON reports(client_id);

-- ============================================================
-- COMPETITORS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS competitors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  citation_count INTEGER DEFAULT 0,
  citation_score INTEGER DEFAULT 0 CHECK (citation_score >= 0 AND citation_score <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_competitors_client_id ON competitors(client_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

-- Agencies: Users can only see/modify their own agency
CREATE POLICY "Users can view own agency"
  ON agencies FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own agency"
  ON agencies FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agency"
  ON agencies FOR UPDATE
  USING (auth.uid() = user_id);

-- Clients: Users can manage clients through their agency
CREATE POLICY "Users can view own clients"
  ON clients FOR SELECT
  USING (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own clients"
  ON clients FOR INSERT
  WITH CHECK (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own clients"
  ON clients FOR UPDATE
  USING (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own clients"
  ON clients FOR DELETE
  USING (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

-- Citations: Through client -> agency chain
CREATE POLICY "Users can view own citations"
  ON citations FOR SELECT
  USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN agencies a ON c.agency_id = a.id
    WHERE a.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own citations"
  ON citations FOR INSERT
  WITH CHECK (client_id IN (
    SELECT c.id FROM clients c
    JOIN agencies a ON c.agency_id = a.id
    WHERE a.user_id = auth.uid()
  ));

CREATE POLICY "Users can update own citations"
  ON citations FOR UPDATE
  USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN agencies a ON c.agency_id = a.id
    WHERE a.user_id = auth.uid()
  ));

-- Reports: Through client -> agency chain
CREATE POLICY "Users can view own reports"
  ON reports FOR SELECT
  USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN agencies a ON c.agency_id = a.id
    WHERE a.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own reports"
  ON reports FOR INSERT
  WITH CHECK (client_id IN (
    SELECT c.id FROM clients c
    JOIN agencies a ON c.agency_id = a.id
    WHERE a.user_id = auth.uid()
  ));

-- Competitors: Through client -> agency chain
CREATE POLICY "Users can view own competitors"
  ON competitors FOR SELECT
  USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN agencies a ON c.agency_id = a.id
    WHERE a.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own competitors"
  ON competitors FOR INSERT
  WITH CHECK (client_id IN (
    SELECT c.id FROM clients c
    JOIN agencies a ON c.agency_id = a.id
    WHERE a.user_id = auth.uid()
  ));

-- Directories: Public read access (no write from client)
ALTER TABLE directories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view directories"
  ON directories FOR SELECT
  TO authenticated
  USING (true);
