import { useState, useEffect } from 'react';
import { Settings, Save, Check, AlertCircle, Loader2, CloudLightning } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';

interface SystemSettings {
  id: string;
  organizationName: string;
  measurementUnits: string;
  cloudflareApiUrl: string | null;
  cloudflareApiKey: string | null;
}

export function SettingsPage() {
  const [_settings, setSettings] = useState<SystemSettings | null>(null);
  const [orgName, setOrgName] = useState('');
  const [units, setUnits] = useState('metric');
  const [cfUrl, setCfUrl] = useState('');
  const [cfKey, setCfKey] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const res = await apiClient.get('/system-settings');
        const data = res.data.data;
        setSettings(data);
        setOrgName(data.organizationName || '');
        setUnits(data.measurementUnits || 'metric');
        setCfUrl(data.cloudflareApiUrl || '');
        setCfKey(data.cloudflareApiKey || '');
      } catch (err: any) {
        setMessage({
          type: 'error',
          text: err.response?.data?.message || 'Gagal memuat pengaturan sistem',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    try {
      setSaving(true);
      const payload = {
        organizationName: orgName,
        measurementUnits: units,
        cloudflareApiUrl: cfUrl,
        cloudflareApiKey: cfKey,
      };

      const res = await apiClient.patch('/system-settings', payload);
      setSettings(res.data.data);
      setMessage({ type: 'success', text: 'Pengaturan berhasil disimpan!' });
    } catch (err: any) {
      let errorMsg = err.response?.data?.error?.message || err.response?.data?.message || 'Gagal menyimpan pengaturan';
      const details = err.response?.data?.error?.details;
      if (details && typeof details === 'object') {
        const specificErrors = Object.values(details).flat().join(', ');
        if (specificErrors) errorMsg += `: ${specificErrors}`;
      }

      setMessage({
        type: 'error',
        text: errorMsg,
      });
    } finally {
      setSaving(false);
    }
  };

  const isMasked = cfKey === '********';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p>Memuat konfigurasi global...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 animate-in fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center">
          <Settings className="mr-3 h-8 w-8 text-muted-foreground" /> Pengaturan Umum
        </h2>
        <p className="text-muted-foreground mt-1">
          Konfigurasi baku operasional aplikasi dan kunci koneksi server data.
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-md flex items-center gap-3 text-sm ${
          message.type === 'success' 
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
            : 'bg-destructive/10 border border-destructive/20 text-destructive'
        }`}>
          {message.type === 'success' ? <Check className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Instansi & Organisasi</CardTitle>
            <CardDescription>Digunakan untuk pelabelan dokumen laporan cetak.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nama Organisasi / Kelompok Tani</label>
              <input 
                required
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Satuan Ukur Luas</label>
              <select 
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="metric">Metrik (Hektar / $m^2$)</option>
                <option value="imperial">Imperial (Acre / $ft^2$)</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20">
          <CardHeader className="bg-amber-500/5 border-b border-amber-500/10">
            <CardTitle className="text-lg flex items-center text-amber-600 dark:text-amber-400">
              <CloudLightning className="mr-2 h-5 w-5" /> Integrasi Penyimpanan Eksternal
            </CardTitle>
            <CardDescription className="text-amber-600/70">
              Pengaturan API Cloudflare R2 untuk akses Drone Orthomosaic.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cloudflare API URL</label>
              <input 
                type="url"
                disabled={isMasked}
                placeholder="https://<account-id>.r2.cloudflarestorage.com"
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                value={cfUrl}
                onChange={(e) => setCfUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Cloudflare API Key / Token</label>
              <input 
                type={isMasked ? "text" : "password"}
                disabled={isMasked}
                placeholder="••••••••••••••••••••••••••••••••"
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                value={cfKey}
                onChange={(e) => setCfKey(e.target.value)}
              />
              {isMasked && (
                <p className="text-xs text-amber-600 font-medium flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3.5 w-3.5" /> Kolom API Key disembunyikan. Hanya pengguna system_admin yang dapat merubah nilai ini.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || isMasked}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Simpan Konfigurasi
          </Button>
        </div>
      </form>
    </div>
  );
}
