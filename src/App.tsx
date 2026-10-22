/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Plane,
  Bell,
  Settings,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Play,
  Square,
  Trash2,
  HelpCircle,
  Send,
  Calendar,
  Info,
  Sliders,
  Wifi,
  ExternalLink,
  Check,
  X,
  Database
} from 'lucide-react';
import { AppConfig, ScrapeLogEntry, ServerStatus } from './types';
import { ALL_AIRLINES, getAirlineUrl } from './airlinesData';
import { getJalaliFromGregorianString } from './dateUtils';

export default function App() {
  const [config, setConfig] = useState<AppConfig>({
    origin: 'IKA',
    destination: 'NJF',
    departureDateGregorian: '2026-07-25',
    departureDates: ['2026-07-25', '2026-07-26'],
    minSeatsRequired: 3,
    checkIntervalMinutes: 1,
    baleToken: '',
    baleChatId: '',
    isMonitoring: true,
    useSimulationMode: false,
    proxyUrl: '',
    enabledAirlines: ['zagros', 'qeshm', 'kish', 'sepehran', 'aseman'],
  });

  const [status, setStatus] = useState<ServerStatus>({
    isMonitoring: false,
    lastCheckTime: null,
    nextCheckTime: null,
    checkCount: 0,
    alertsSentCount: 0,
    activeLogs: [],
  });

  const [testToken, setTestToken] = useState('');
  const [testChatId, setTestChatId] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [triggerLoading, setTriggerLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [selectedLog, setSelectedLog] = useState<ScrapeLogEntry | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings' | 'airlines'>('dashboard');
  const [newDateInput, setNewDateInput] = useState('2026-07-27');

  // Fetch initial config and status
  useEffect(() => {
    fetchConfigAndStatus();
    const timer = setInterval(fetchStatusOnly, 5000); // poll status every 5s
    return () => clearInterval(timer);
  }, []);

  const fetchConfigAndStatus = async () => {
    try {
      const [configRes, statusRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/status')
      ]);
      if (configRes.ok) {
        const c = await configRes.json();
        setConfig(c);
        setTestToken(c.baleToken);
        setTestChatId(c.baleChatId);
      }
      if (statusRes.ok) {
        setStatus(await statusRes.json());
      }
    } catch (err) {
      console.error('Failed to load server data:', err);
    }
  };

  const fetchStatusOnly = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleConfigChange = (key: keyof AppConfig, value: any) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleAddDate = () => {
    if (!newDateInput) return;
    const currentDates = config.departureDates || [];
    if (currentDates.includes(newDateInput)) return;
    const updatedDates = [...currentDates, newDateInput].sort();
    setConfig((prev) => ({
      ...prev,
      departureDates: updatedDates,
      departureDateGregorian: updatedDates[0] || prev.departureDateGregorian,
    }));
  };

  const handleRemoveDate = (dateToRemove: string) => {
    const currentDates = config.departureDates || [];
    const updatedDates = currentDates.filter((d) => d !== dateToRemove);
    setConfig((prev) => ({
      ...prev,
      departureDates: updatedDates,
      departureDateGregorian: updatedDates[0] || prev.departureDateGregorian,
    }));
  };

  const handleAirlineToggle = (id: string) => {
    setConfig((prev) => {
      const enabled = prev.enabledAirlines.includes(id)
        ? prev.enabledAirlines.filter((x) => x !== id)
        : [...prev.enabledAirlines, id];
      return { ...prev, enabledAirlines: enabled };
    });
  };

  const handleSelectAllAirlines = () => {
    setConfig((prev) => ({
      ...prev,
      enabledAirlines: ALL_AIRLINES.map((a) => a.id)
    }));
  };

  const handleSelectNoneAirlines = () => {
    setConfig((prev) => ({
      ...prev,
      enabledAirlines: []
    }));
  };

  const saveConfig = async (updatedConfig = config) => {
    setSaveLoading(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveMessage({ success: true, text: 'تنظیمات با موفقیت ذخیره شد.' });
        fetchStatusOnly();
      } else {
        setSaveMessage({ success: false, text: data.error || 'خطا در ذخیره تنظیمات' });
      }
    } catch (err: any) {
      setSaveMessage({ success: false, text: `خطای سرور: ${err.message}` });
    } finally {
      setSaveLoading(false);
      // Clear message after 4 seconds
      setTimeout(() => setSaveMessage(null), 4000);
    }
  };

  const toggleMonitoring = async () => {
    const nextState = !config.isMonitoring;
    const updated = { ...config, isMonitoring: nextState };
    setConfig(updated);
    await saveConfig(updated);
  };

  const triggerManualCheck = async () => {
    setTriggerLoading(true);
    try {
      const res = await fetch('/api/trigger-check', { method: 'POST' });
      if (res.ok) {
        fetchStatusOnly();
      }
    } catch (err) {
      console.error('Manual check failed:', err);
    } finally {
      setTriggerLoading(false);
    }
  };

  const testBaleConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/test-bale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: testToken, chatId: testChatId }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ success: true, message: data.message });
      } else {
        setTestResult({ success: false, message: data.error || 'خطا در برقراری ارتباط' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: `خطا: ${err.message}` });
    } finally {
      setTestLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      const res = await fetch('/api/clear-logs', { method: 'POST' });
      if (res.ok) {
        fetchStatusOnly();
        setSelectedLog(null);
      }
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  const shamsiDate = getJalaliFromGregorianString(config.departureDateGregorian);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-cyan-500 selection:text-slate-900" dir="rtl">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-violet-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg shadow-cyan-500/20 text-slate-950 animate-pulse">
              <Plane className="w-6 h-6 rotate-45" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-white via-slate-100 to-cyan-400 bg-clip-text text-transparent">
                بلیط‌یاب
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                پایش خودکار ظرفیت بلیط پرواز و اطلاع‌رسانی در پیام‌رسان بله
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleMonitoring}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                config.isMonitoring
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20'
              }`}
            >
              {config.isMonitoring ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>در حال رصد فعال</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-rose-400" />
                  <span>متوقف شده</span>
                </>
              )}
            </button>

            <button
              onClick={triggerManualCheck}
              disabled={triggerLoading}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${triggerLoading ? 'animate-spin' : ''}`} />
              <span>بررسی فوری</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
        
        {/* Quick Stats Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span>وضعیت پایش</span>
              <Wifi className={`w-4 h-4 ${config.isMonitoring ? 'text-emerald-400' : 'text-rose-400'}`} />
            </div>
            <div className="text-lg font-bold">
              {config.isMonitoring ? 'پایش لحظه‌ای فعال' : 'غیرفعال'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {config.useSimulationMode ? 'حالت شبیه‌سازی فعال است' : 'حالت رصد واقعی'}
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span>دفعات بررسی</span>
              <Database className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-xl font-bold text-cyan-400">{status.checkCount} مرتبه</div>
            <div className="text-xs text-slate-400 mt-1">
              آخرین: {status.lastCheckTime ? new Date(status.lastCheckTime).toLocaleTimeString('fa-IR') : 'هرگز'}
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span>هشدارهای بله</span>
              <Bell className="w-4 h-4 text-violet-400" />
            </div>
            <div className="text-xl font-bold text-violet-400">{status.alertsSentCount} هشدار</div>
            <div className="text-xs text-slate-400 mt-1">ارسال شده به بله</div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span>تاریخ‌های هدف پایش</span>
              <Calendar className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex flex-wrap gap-1 max-h-[48px] overflow-y-auto custom-scrollbar">
              {config.departureDates && config.departureDates.length > 0 ? (
                config.departureDates.map((d) => (
                  <span key={d} className="bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded text-[10px] font-bold text-amber-400">
                    {getJalaliFromGregorianString(d)}
                  </span>
                ))
              ) : (
                <span className="text-sm font-bold text-amber-400">{shamsiDate || 'نامشخص'}</span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {config.origin} ← {config.destination} (حداقل {config.minSeatsRequired} صندلی)
            </div>
          </div>
        </section>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 mb-6 gap-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-[2px] ${
              activeTab === 'dashboard'
                ? 'border-cyan-400 text-cyan-400 bg-slate-900/40 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            داشبورد و گزارشات
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-[2px] ${
              activeTab === 'settings'
                ? 'border-cyan-400 text-cyan-400 bg-slate-900/40 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            تنظیمات ربات
          </button>
          <button
            onClick={() => setActiveTab('airlines')}
            className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-[2px] ${
              activeTab === 'airlines'
                ? 'border-cyan-400 text-cyan-400 bg-slate-900/40 rounded-t-lg'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            سایت‌های ایرلاین‌ها ({ALL_AIRLINES.length})
          </button>
        </div>

        {/* Tab Contents */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Logs List - Left 2 Columns */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <span>تاریخچه آخرین پایش‌ها</span>
                  <span className="px-2 py-0.5 text-xs font-mono bg-slate-800 text-slate-300 rounded-full">
                    {status.activeLogs.length} ثبت شده
                  </span>
                </h3>
                {status.activeLogs.length > 0 && (
                  <button
                    onClick={clearLogs}
                    className="text-rose-400 hover:text-rose-300 text-xs flex items-center gap-1 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>پاک کردن گزارشات</span>
                  </button>
                )}
              </div>

              {status.activeLogs.length === 0 ? (
                <div className="bg-slate-900/30 border border-slate-800/80 rounded-2xl p-12 text-center text-slate-500">
                  <Info className="w-8 h-8 mx-auto mb-3 opacity-40 text-slate-400" />
                  <p className="text-sm">هیچ گزارشی ثبت نشده است.</p>
                  <p className="text-xs mt-1">با زدن دکمه «بررسی فوری» می‌توانید اولین پایش را همین حالا شروع کنید.</p>
                </div>
              ) : (
                <div className="bg-slate-900/30 border border-slate-800/80 rounded-2xl overflow-hidden max-h-[600px] overflow-y-auto divide-y divide-slate-800/60 custom-scrollbar">
                  {status.activeLogs.map((log) => {
                    const isSystem = log.airlineId === 'system';
                    const isSuccess = log.success;
                    const hasFlights = log.flightsFound > 0;
                    
                    return (
                      <div
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className={`p-4 hover:bg-slate-900/60 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          selectedLog?.id === log.id ? 'bg-slate-900/80' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                            isSystem ? 'bg-indigo-400' :
                            !isSuccess ? 'bg-rose-500' :
                            hasFlights ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                          }`} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm">{log.airlineName}</span>
                              <span className="text-slate-500 text-[10px]">
                                {new Date(log.timestamp).toLocaleTimeString('fa-IR')}
                              </span>
                            </div>
                            <p className={`text-xs mt-1 leading-relaxed ${
                              !isSuccess ? 'text-rose-400' :
                              hasFlights ? 'text-emerald-400' : 'text-slate-300'
                            }`}>
                              {log.message}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 shrink-0">
                          {hasFlights && (
                            <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg">
                              {log.flightsFound} پرواز پیدا شد
                            </span>
                          )}
                          {!isSuccess && (
                            <span className="px-2 py-0.5 text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg">
                              خطا
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Log Details Panel - Right 1 Column */}
            <div className="flex flex-col gap-4">
              <h3 className="text-base font-semibold">جزئیات پاسخ و خطاها</h3>
              <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 min-h-[300px] flex flex-col justify-between shadow-sm backdrop-blur-sm">
                {selectedLog ? (
                  <div className="flex flex-col h-full gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-bold text-sm text-cyan-400">{selectedLog.airlineName}</h4>
                        <span className="text-[10px] text-slate-500">
                          {new Date(selectedLog.timestamp).toLocaleString('fa-IR')}
                        </span>
                      </div>
                      
                      <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/60 mb-4">
                        <div className="text-xs font-bold text-slate-400 mb-1">گزارش وضعیت:</div>
                        <div className="text-xs leading-relaxed">{selectedLog.message}</div>
                      </div>

                      {selectedLog.details && (
                        <div>
                          <div className="text-xs font-bold text-slate-400 mb-1">داده خام / مستندات خطا:</div>
                          <pre className="text-[10px] font-mono bg-slate-950 border border-slate-800 p-3 rounded-xl overflow-x-auto max-h-[250px] leading-relaxed custom-scrollbar text-slate-300">
                            {selectedLog.details}
                          </pre>
                        </div>
                      )}
                    </div>
                    
                    <div className="border-t border-slate-800/60 pt-4 mt-auto">
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        نکته: در صورت دریافت خطای مسدودیت IP (مثل ۴۰۳ یا Timeout) به این دلیل است که شرکت‌های هواپیمایی ایران دسترسی را فقط به داخل ایران محدود کرده‌اند. در تنظیمات می‌توانید حالت شبیه‌ساز را جهت تست روشن نگه دارید.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 py-12">
                    <Sliders className="w-8 h-8 mb-2 opacity-30 text-slate-400" />
                    <p className="text-xs">روی یکی از لاگ‌های پایش سمت راست کلیک کنید تا جزئیات کامل فنی و ساختار پاسخ اینجا نمایش داده شود.</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Setting Form - Left 2 Columns */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
                <h3 className="text-base font-bold mb-6 flex items-center gap-2 text-cyan-400 border-b border-slate-800 pb-3">
                  <Sliders className="w-5 h-5 text-cyan-400" />
                  <span>پارامترهای جستجوی پرواز</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">فرودگاه مبدا (مخفف یاتا)</label>
                    <input
                      type="text"
                      value={config.origin}
                      onChange={(e) => handleConfigChange('origin', e.target.value.toUpperCase())}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-white focus:outline-none focus:border-cyan-500 transition-all text-left"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">فرودگاه مقصد (مخفف یاتا)</label>
                    <input
                      type="text"
                      value={config.destination}
                      onChange={(e) => handleConfigChange('destination', e.target.value.toUpperCase())}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-white focus:outline-none focus:border-cyan-500 transition-all text-left"
                    />
                  </div>

                  <div className="md:col-span-2 border-b border-slate-800/80 pb-6 mb-2">
                    <label className="block text-xs font-semibold text-slate-400 mb-3">تاریخ‌های مورد نظر جهت پایش (امکان افزودن چندین تاریخ همزمان)</label>
                    <div className="flex flex-wrap gap-2 mb-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800">
                      {config.departureDates && config.departureDates.length > 0 ? (
                        config.departureDates.map((date) => (
                          <div key={date} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200">
                            <span className="font-semibold">{getJalaliFromGregorianString(date)}</span>
                            <span className="opacity-55 font-mono">({date})</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveDate(date)}
                              className="text-rose-400 hover:text-rose-300 transition-all ml-1"
                              title="حذف تاریخ"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-slate-500 py-1">هیچ تاریخی برای مانیتورینگ تعریف نشده است. لطفاً حداقل یک تاریخ اضافه کنید.</div>
                      )}
                    </div>

                    <div className="flex gap-2 max-w-md">
                      <input
                        type="date"
                        value={newDateInput}
                        onChange={(e) => setNewDateInput(e.target.value)}
                        className="bg-slate-950/85 border border-slate-800 rounded-xl px-4 py-2 text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 transition-all text-left flex-1"
                      />
                      <button
                        type="button"
                        onClick={handleAddDate}
                        className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl transition-all"
                      >
                        افزودن تاریخ پایش
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-2 block">
                      برای پایش همزمان چندین تاریخ (مثلا ۳ و ۴ مرداد ۱۴۰۵ معادل ۲۵ و ۲۶ ژوئیه ۲۰۲۶)، تک‌تک تاریخ‌ها را انتخاب کرده و دکمه افزودن را بزنید.
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">حداقل ظرفیت خالی صندلی</label>
                    <input
                      type="number"
                      min="1"
                      max="9"
                      value={config.minSeatsRequired}
                      onChange={(e) => handleConfigChange('minSeatsRequired', parseInt(e.target.value, 10) || 3)}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-white focus:outline-none focus:border-cyan-500 transition-all"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">اگر حداقل این تعداد صندلی باز شد، اطلاع بده (پیش‌فرض: ۳).</span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">فاصله زمانی بررسی (دقیقه)</label>
                    <input
                      type="number"
                      min="1"
                      value={config.checkIntervalMinutes}
                      onChange={(e) => handleConfigChange('checkIntervalMinutes', parseInt(e.target.value, 10) || 1)}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-white focus:outline-none focus:border-cyan-500 transition-all"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">پایش سایت‌ها هر چند دقیقه یکبار تکرار شود (پیش‌فرض: ۱ دقیقه).</span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">حالت شبیه‌ساز (توصیه شده در هاست خارجی)</label>
                    <div className="flex items-center gap-3 h-10 mt-1">
                      <button
                        type="button"
                        onClick={() => handleConfigChange('useSimulationMode', !config.useSimulationMode)}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                          config.useSimulationMode
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-slate-800 text-slate-400 border-transparent'
                        }`}
                      >
                        {config.useSimulationMode ? 'فعال (شبیه‌سازی پرواز)' : 'غیرفعال (رصد واقعی سایت‌ها)'}
                      </button>
                    </div>
                  </div>

                  <div className="md:col-span-2 border-t border-slate-800/40 pt-4 mt-2">
                    <label className="block text-xs font-semibold text-slate-400 mb-2">آدرس پروکسی ایران (پروکسی HTTP یا SOCKS5)</label>
                    <input
                      type="text"
                      placeholder="e.g. http://username:password@ip:port"
                      value={config.proxyUrl || ''}
                      onChange={(e) => handleConfigChange('proxyUrl', e.target.value)}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500 transition-all text-left"
                    />
                    <span className="text-[10px] text-slate-400 mt-1.5 block leading-relaxed">
                      جهت دور زدن مسدودیت آی‌پی‌های خارج از کشور توسط ایرلاین‌ها، می‌توانید یک پروکسی ایران (در قالب آدرس بالا) تنظیم نمایید تا تمام وب‌اسکرپینگ پروازها از این طریق فرستاده شود.
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950/40 p-4 border border-slate-800/80 rounded-xl text-xs text-slate-400 mb-6 leading-relaxed flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-slate-200 font-bold block mb-1">اطلاعات مسدودیت آی‌پی (Geo-Blocking):</span>
                    اکثر ایرلاین‌های ایرانی (مانند زاگرس، کیش ایر، قشم و ...) به صورت سخت‌گیرانه دسترسی سرورهای با آی‌پی خارجی (از جمله گوگل کلاود که این اپ در آن اجرا می‌شود) را فیلتر و مسدود می‌کنند.
                    بنابراین اگر پایش واقعی را فعال کنید، به احتمال زیاد با خطای مسدودیت (۴۰۳) روبرو خواهید شد.
                    ما <b className="text-amber-400">سیستم شبیه‌ساز هوشمند</b> را توسعه دادیم تا بتوانید به صورت ۱۰۰٪ ایمن و روان، کارکرد ربات و اتصال بله را تست کنید. شبیه‌ساز به صورت دوره‌ای صندلی‌هایی را باز می‌کند تا پیام‌های بله را به گوشی شما روانه کند!
                  </div>
                </div>

                {/* Airlines selection */}
                <div className="border-t border-slate-800/80 pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-sm text-slate-300">انتخاب شرکت‌های هواپیمایی جهت پایش:</h4>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAllAirlines}
                        className="text-[10px] bg-slate-800 text-slate-300 px-2.5 py-1 rounded-lg hover:bg-slate-700 transition-all"
                      >
                        انتخاب همه
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectNoneAirlines}
                        className="text-[10px] bg-slate-800 text-slate-300 px-2.5 py-1 rounded-lg hover:bg-slate-700 transition-all"
                      >
                        لغو همه
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {ALL_AIRLINES.map((airline) => {
                      const isEnabled = config.enabledAirlines.includes(airline.id);
                      return (
                        <button
                          key={airline.id}
                          type="button"
                          onClick={() => handleAirlineToggle(airline.id)}
                          className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-right transition-all ${
                            isEnabled
                              ? 'bg-cyan-500/5 text-cyan-400 border-cyan-500/20'
                              : 'bg-slate-950/20 text-slate-400 border-slate-800/60 hover:border-slate-800'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                            isEnabled ? 'bg-cyan-500 border-cyan-500 text-slate-950' : 'border-slate-700'
                          }`}>
                            {isEnabled && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-200">{airline.nameFa}</div>
                            <div className="text-[9px] text-slate-500 font-mono mt-0.5">{airline.name}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-slate-800/80 pt-6 mt-6 flex justify-between items-center gap-4">
                  <button
                    type="button"
                    onClick={() => saveConfig()}
                    disabled={saveLoading}
                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-slate-950 rounded-xl font-bold transition-all disabled:opacity-50 text-sm shadow-md shadow-cyan-500/10"
                  >
                    {saveLoading ? 'در حال ذخیره‌سازی...' : 'ذخیره پارامترها'}
                  </button>

                  {saveMessage && (
                    <div className={`text-xs font-bold flex items-center gap-1.5 ${saveMessage.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {saveMessage.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      <span>{saveMessage.text}</span>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Bale Token Info - Right 1 Column */}
            <div className="flex flex-col gap-6">
              <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
                <h3 className="text-base font-bold mb-4 flex items-center gap-2 text-violet-400 border-b border-slate-800 pb-3">
                  <Bell className="w-5 h-5 text-violet-400" />
                  <span>اتصال پیام‌رسان بله</span>
                </h3>

                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">توکن ربات بله (Bale Token)</label>
                    <input
                      type="text"
                      placeholder="e.g. 123456789:ABCdefGhI..."
                      value={testToken}
                      onChange={(e) => {
                        setTestToken(e.target.value);
                        handleConfigChange('baleToken', e.target.value);
                      }}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-violet-500 transition-all text-left"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-2">شناسه چت بله (Chat ID)</label>
                    <input
                      type="text"
                      placeholder="e.g. 987654321"
                      value={testChatId}
                      onChange={(e) => {
                        setTestChatId(e.target.value);
                        handleConfigChange('baleChatId', e.target.value);
                      }}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-violet-500 transition-all text-left"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={testBaleConnection}
                    disabled={testLoading || !testToken || !testChatId}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{testLoading ? 'در حال ارسال پیام تست...' : 'ارسال تست به بله'}</span>
                  </button>

                  {testResult && (
                    <div className={`p-3 rounded-xl border text-xs leading-relaxed ${
                      testResult.success
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/5 border-rose-500/20 text-rose-400'
                    }`}>
                      <div className="font-bold flex items-center gap-1 mb-1">
                        {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        <span>{testResult.success ? 'ارسال با موفقیت انجام شد' : 'خطا در ارسال'}</span>
                      </div>
                      <p className="text-[11px] opacity-90">{testResult.message}</p>
                    </div>
                  )}

                  <div className="border-t border-slate-800/80 pt-4 mt-2">
                    <h4 className="text-xs font-bold text-slate-300 mb-2">راهنمای راه‌اندازی ربات بله:</h4>
                    <ol className="list-decimal list-inside text-[11px] text-slate-400 space-y-2 leading-relaxed">
                      <li>به ربات پدر ربات‌ها در بله (<b className="text-slate-200">@botfather</b>) پیام دهید و دستور <code className="bg-slate-950 px-1 py-0.5 rounded text-violet-400">/newbot</code> را بفرستید تا ربات جدیدی ایجاد شود.</li>
                      <li>توکن دریافتی را کپی کرده و در فیلد بالا قرار دهید.</li>
                      <li>وارد ربات خود شوید و دکمه <code className="bg-slate-950 px-1 py-0.5 rounded text-violet-400">/start</code> را بزنید.</li>
                      <li>شناسه کاربری (Chat ID) خود را بدست آورده و در فیلد بالا بگذارید (می‌توانید از ربات‌هایی مثل <code className="bg-slate-950 px-1 py-0.5 rounded text-violet-400">@userinfobot</code> در بله کمک بگیرید).</li>
                      <li>دکمه «ارسال تست به بله» را بزنید تا از اتصال ربات مطمئن شوید!</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {activeTab === 'airlines' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-200">لیست کامل درگاه‌های خرید و پایش ایرلاین‌ها</h3>
                <p className="text-xs text-slate-400 mt-1">این سیستم به صورت پویا با پارامترهای مبدا {config.origin} و مقصد {config.destination} برای تاریخ {config.departureDateGregorian} لینک‌های اختصاصی می‌سازد.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ALL_AIRLINES.map((airline) => {
                const link = getAirlineUrl(airline, {
                  origin: config.origin,
                  destination: config.destination,
                  dateGregorian: config.departureDateGregorian,
                  dateShamsi: shamsiDate,
                  minSeats: config.minSeatsRequired,
                });

                return (
                  <div key={airline.id} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-800 transition-all flex flex-col justify-between gap-4 shadow-sm backdrop-blur-sm">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-base text-slate-200">{airline.nameFa}</span>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                          {airline.systemType.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono mb-3">{airline.name}</div>
                      
                      <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/40">
                        <div className="text-[10px] text-slate-500 mb-1">ساختار لینک مانیتورینگ:</div>
                        <div className="text-[10px] font-mono break-all text-slate-400 select-all leading-relaxed max-h-16 overflow-y-auto custom-scrollbar">{link}</div>
                      </div>
                    </div>

                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer referrerPolicy=no-referrer"
                      className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-all border border-slate-700/60"
                    >
                      <span>ورود به سایت مستقیم خرید</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-8 mt-12 relative z-10 text-center">
        <div className="max-w-7xl mx-auto px-4 text-slate-500 text-xs leading-relaxed">
          <p>بلیط‌یاب — پایش هوشمند ظرفیت بلیط پرواز</p>
          <p className="mt-1">صرفاً جهت اطلاع‌رسانی باز شدن ظرفیت‌ها در پیام‌رسان بله. طراحی شده با بالاترین دقت پایش و فرکانس بررسی.</p>
        </div>
      </footer>
    </div>
  );
}
