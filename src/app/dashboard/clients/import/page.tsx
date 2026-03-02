'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface ParsedClient {
  business_name: string;
  address: string;
  city: string;
  postcode: string;
  phone: string;
  category?: string;
  website?: string;
  email?: string;
}

interface ImportResult {
  business_name: string;
  status: 'imported' | 'duplicate' | 'error';
  client_id?: string;
  error?: string;
  scan_triggered?: boolean;
}

interface ImportSummary {
  total_submitted: number;
  imported: number;
  duplicates: number;
  errors: number;
  scans_triggered: number;
}

// Map common CSV header variations to our field names
const HEADER_MAPPINGS: Record<string, string> = {
  // Business name variations
  business_name: 'business_name',
  businessname: 'business_name',
  'business name': 'business_name',
  company: 'business_name',
  'company name': 'business_name',
  companyname: 'business_name',
  name: 'business_name',
  business: 'business_name',

  // Address variations
  address: 'address',
  'street address': 'address',
  streetaddress: 'address',
  street: 'address',
  address1: 'address',
  'address line 1': 'address',

  // City variations
  city: 'city',
  town: 'city',
  'town/city': 'city',
  towncity: 'city',
  locality: 'city',

  // Postcode variations
  postcode: 'postcode',
  'post code': 'postcode',
  postal_code: 'postcode',
  postalcode: 'postcode',
  'postal code': 'postcode',
  zip: 'postcode',
  zipcode: 'postcode',
  'zip code': 'postcode',

  // Phone variations
  phone: 'phone',
  telephone: 'phone',
  tel: 'phone',
  'phone number': 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  'contact number': 'phone',

  // Category variations
  category: 'category',
  type: 'category',
  'business type': 'category',
  businesstype: 'category',
  industry: 'category',
  sector: 'category',

  // Website variations
  website: 'website',
  url: 'website',
  web: 'website',
  site: 'website',
  'web address': 'website',

  // Email variations
  email: 'email',
  'email address': 'email',
  emailaddress: 'email',
  'e-mail': 'email',
};

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // Parse CSV handling quoted fields
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"' && inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);

  return { headers, rows };
}

function mapHeaders(headers: string[]): Map<number, string> {
  const mapping = new Map<number, string>();

  headers.forEach((header, index) => {
    const normalised = header.toLowerCase().trim();
    const mappedField = HEADER_MAPPINGS[normalised];
    if (mappedField) {
      mapping.set(index, mappedField);
    }
  });

  return mapping;
}

function rowToClient(row: string[], headerMapping: Map<number, string>): ParsedClient | null {
  const client: Partial<ParsedClient> = {};

  headerMapping.forEach((field, index) => {
    if (row[index]) {
      (client as Record<string, string>)[field] = row[index];
    }
  });

  // Validate required fields
  if (!client.business_name || !client.address || !client.city || !client.postcode || !client.phone) {
    return null;
  }

  return client as ParsedClient;
}

export default function ImportClientsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedClients, setParsedClients] = useState<ParsedClient[]>([]);
  const [invalidRows, setInvalidRows] = useState<number[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback((file: File) => {
    setError(null);
    setImportResults(null);
    setImportSummary(null);

    if (!file.name.endsWith('.csv')) {
      setError('Please upload a CSV file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const { headers, rows } = parseCSV(text);

        if (headers.length === 0) {
          setError('CSV file appears to be empty');
          return;
        }

        const headerMapping = mapHeaders(headers);

        // Check required fields are mapped
        const mappedFields = new Set(headerMapping.values());
        const requiredFields = ['business_name', 'address', 'city', 'postcode', 'phone'];
        const missingFields = requiredFields.filter((f) => !mappedFields.has(f));

        if (missingFields.length > 0) {
          setError(
            `CSV is missing required columns: ${missingFields.join(', ')}. ` +
              `Found columns: ${headers.join(', ')}`
          );
          return;
        }

        const clients: ParsedClient[] = [];
        const invalid: number[] = [];

        rows.forEach((row, index) => {
          const client = rowToClient(row, headerMapping);
          if (client) {
            clients.push(client);
          } else {
            invalid.push(index + 2); // +2 for header row and 1-based indexing
          }
        });

        if (clients.length === 0) {
          setError('No valid client rows found in CSV');
          return;
        }

        setFile(file);
        setParsedClients(clients);
        setInvalidRows(invalid);
      } catch (err) {
        console.error('CSV parse error:', err);
        setError('Failed to parse CSV file');
      }
    };

    reader.onerror = () => {
      setError('Failed to read file');
    };

    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        processFile(droppedFile);
      }
    },
    [processFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        processFile(selectedFile);
      }
    },
    [processFile]
  );

  const handleImport = async () => {
    if (parsedClients.length === 0) return;

    setIsImporting(true);
    setError(null);

    try {
      // Get agency ID
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Please sign in to import clients');
        return;
      }

      const { data: agency } = await supabase
        .from('agencies')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!agency) {
        setError('No agency found for your account');
        return;
      }

      const response = await fetch('/api/clients/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agency_id: agency.id,
          clients: parsedClients,
          trigger_scans: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Import failed');
        return;
      }

      setImportResults(data.results);
      setImportSummary(data.summary);
    } catch (err) {
      console.error('Import error:', err);
      setError('Failed to import clients');
    } finally {
      setIsImporting(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setParsedClients([]);
    setInvalidRows([]);
    setImportResults(null);
    setImportSummary(null);
    setError(null);
  };

  const statusColors: Record<string, string> = {
    imported: 'text-emerald-400 bg-emerald-400/10',
    duplicate: 'text-amber-400 bg-amber-400/10',
    error: 'text-red-400 bg-red-400/10',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Import Clients</h1>
          <p className="mt-1 text-sm text-gray-400">
            Upload a CSV file to bulk import clients
          </p>
        </div>
        {(file || importResults) && (
          <button
            onClick={handleReset}
            className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
          >
            Start Over
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Import complete summary */}
      {importSummary && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Import Complete</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="rounded-lg bg-gray-800/50 p-4">
              <p className="text-2xl font-bold text-white">{importSummary.total_submitted}</p>
              <p className="text-xs text-gray-400">Total Submitted</p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-4">
              <p className="text-2xl font-bold text-emerald-400">{importSummary.imported}</p>
              <p className="text-xs text-gray-400">Imported</p>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-4">
              <p className="text-2xl font-bold text-amber-400">{importSummary.duplicates}</p>
              <p className="text-xs text-gray-400">Duplicates</p>
            </div>
            <div className="rounded-lg bg-red-500/10 p-4">
              <p className="text-2xl font-bold text-red-400">{importSummary.errors}</p>
              <p className="text-xs text-gray-400">Errors</p>
            </div>
            <div className="rounded-lg bg-blue-500/10 p-4">
              <p className="text-2xl font-bold text-blue-400">{importSummary.scans_triggered}</p>
              <p className="text-xs text-gray-400">Scans Started</p>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => router.push('/dashboard/clients')}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              View All Clients
            </button>
            <button
              onClick={handleReset}
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            >
              Import More
            </button>
          </div>
        </div>
      )}

      {/* Import results table */}
      {importResults && (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-900/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                  Business Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {importResults.map((result, index) => (
                <tr key={index} className="transition-colors hover:bg-gray-900/50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-white">
                    {result.business_name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusColors[result.status]}`}
                    >
                      {result.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">
                    {result.error || (result.scan_triggered ? 'Citation scan started' : 'Imported')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drop zone - only show if no file uploaded yet and no results */}
      {!file && !importResults && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          className={`relative rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
            isDragging
              ? 'border-brand-500 bg-brand-500/5'
              : 'border-gray-700 bg-gray-900/30 hover:border-gray-600'
          }`}
        >
          <input
            type="file"
            accept=".csv"
            onChange={handleFileInput}
            className="absolute inset-0 cursor-pointer opacity-0"
          />

          <div className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <svg
                className="h-8 w-8 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <div>
              <p className="text-lg font-medium text-white">
                Drop your CSV file here
              </p>
              <p className="mt-1 text-sm text-gray-400">
                or click to browse
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Required columns: business_name, address, city, postcode, phone
            </p>
          </div>
        </div>
      )}

      {/* Preview table - show after file parsed but before import */}
      {parsedClients.length > 0 && !importResults && (
        <>
          {/* File info and import button */}
          <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <svg
                  className="h-5 w-5 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <p className="font-medium text-white">{file?.name}</p>
                <p className="text-sm text-gray-400">
                  {parsedClients.length} valid clients found
                  {invalidRows.length > 0 && (
                    <span className="text-amber-400">
                      {' '}
                      ({invalidRows.length} invalid rows skipped)
                    </span>
                  )}
                </p>
              </div>
            </div>

            <button
              onClick={handleImport}
              disabled={isImporting}
              className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isImporting ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Importing...
                </span>
              ) : (
                `Import ${parsedClients.length} Clients`
              )}
            </button>
          </div>

          {/* Preview table */}
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <div className="bg-gray-900/80 px-6 py-3 border-b border-gray-800">
              <h3 className="text-sm font-medium text-gray-400">Preview</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      Business Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      Address
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      City
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      Postcode
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      Category
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {parsedClients.slice(0, 10).map((client, index) => (
                    <tr key={index} className="transition-colors hover:bg-gray-900/50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-white">
                        {client.business_name}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">
                        {client.address}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">
                        {client.city}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">
                        {client.postcode}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">
                        {client.phone}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-400">
                        {client.category || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsedClients.length > 10 && (
              <div className="border-t border-gray-800 bg-gray-900/30 px-6 py-3">
                <p className="text-sm text-gray-500">
                  Showing 10 of {parsedClients.length} clients
                </p>
              </div>
            )}
          </div>

          {/* Invalid rows warning */}
          {invalidRows.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-400">
                <strong>{invalidRows.length} rows</strong> were skipped due to missing required
                fields (rows: {invalidRows.slice(0, 10).join(', ')}
                {invalidRows.length > 10 && ` and ${invalidRows.length - 10} more`})
              </p>
            </div>
          )}
        </>
      )}

      {/* CSV format help */}
      {!file && !importResults && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-6">
          <h3 className="text-sm font-semibold text-white mb-3">CSV Format Guide</h3>
          <div className="space-y-3 text-sm text-gray-400">
            <p>Your CSV file should include these columns (headers are flexible):</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded bg-gray-800/50 px-3 py-2">
                <span className="text-emerald-400">*</span> business_name, company, name
              </div>
              <div className="rounded bg-gray-800/50 px-3 py-2">
                <span className="text-emerald-400">*</span> address, street address
              </div>
              <div className="rounded bg-gray-800/50 px-3 py-2">
                <span className="text-emerald-400">*</span> city, town
              </div>
              <div className="rounded bg-gray-800/50 px-3 py-2">
                <span className="text-emerald-400">*</span> postcode, postal code, zip
              </div>
              <div className="rounded bg-gray-800/50 px-3 py-2">
                <span className="text-emerald-400">*</span> phone, telephone, tel
              </div>
              <div className="rounded bg-gray-800/50 px-3 py-2">
                category, type, industry
              </div>
              <div className="rounded bg-gray-800/50 px-3 py-2">
                website, url
              </div>
              <div className="rounded bg-gray-800/50 px-3 py-2">
                email
              </div>
            </div>
            <p className="text-xs text-gray-500">
              <span className="text-emerald-400">*</span> Required fields
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
