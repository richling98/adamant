import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';

export interface RecordingPreferences {
  save_folder: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
}

/** Duration options for the silence auto-stop feature (label → seconds). */
const SILENCE_DURATION_OPTIONS: { label: string; value: number }[] = [
  { label: '30 seconds', value: 30 },
  { label: '1 minute',   value: 60 },
  { label: '2 minutes',  value: 120 },
  { label: '5 minutes',  value: 300 },
];

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    preferred_mic_device: null,
    preferred_system_device: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);

  // Silence auto-stop preferences (persisted in preferences.json via Tauri plugin-store)
  const [silenceAutoStopEnabled, setSilenceAutoStopEnabled] = useState(true);
  const [silenceTimeoutSecs, setSilenceTimeoutSecs] = useState(60);

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Load plugin-store preferences (notification + silence auto-stop)
  useEffect(() => {
    const loadStoredPrefs = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');

        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);

        const silenceEnabled = await store.get<boolean>('silence_auto_stop_enabled') ?? true;
        setSilenceAutoStopEnabled(silenceEnabled);

        const silenceSecs = await store.get<number>('silence_auto_stop_duration_secs') ?? 60;
        setSilenceTimeoutSecs(silenceSecs);
      } catch (error) {
        console.error('Failed to load stored preferences:', error);
      }
    };
    loadStoredPrefs();
  }, []);

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success('Preference saved');
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error('Failed to save preference');
    }
  };

  /** Persist the silence auto-stop enabled flag. */
  const handleSilenceToggle = async (enabled: boolean) => {
    try {
      setSilenceAutoStopEnabled(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('silence_auto_stop_enabled', enabled);
      await store.save();
      toast.success('Preference saved');
    } catch (error) {
      console.error('Failed to save silence preference:', error);
      toast.error('Failed to save preference');
    }
  };

  /** Persist the chosen silence duration. */
  const handleSilenceDurationChange = async (secs: number) => {
    try {
      setSilenceTimeoutSecs(secs);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('silence_auto_stop_duration_secs', secs);
      await store.save();
      toast.success('Preference saved');
    } catch (error) {
      console.error('Failed to save silence duration:', error);
      toast.error('Failed to save preference');
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      const micDevice = prefs.preferred_mic_device || 'Default';
      const systemDevice = prefs.preferred_system_device || 'Default';
      toast.success("Device preferences saved", {
        description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`
      });
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error("Failed to save device preferences", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-white/10 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-white/10 rounded mb-4"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4 text-white">Recording Settings</h3>
        <p className="text-sm text-zinc-400 mb-6">
          Configure audio devices used during meetings.
        </p>
      </div>

      {/* Recording Notification Toggle */}
      <div className="flex items-center justify-between p-4 border border-white/10 rounded-lg bg-white/5">
        <div className="flex-1">
          <div className="font-medium text-white">Recording Start Notification</div>
          <div className="text-sm text-zinc-400">
            Show legal notice reminder to inform participants when recording starts (US law compliance)
          </div>
        </div>
        <Switch
          checked={showRecordingNotification}
          onCheckedChange={handleNotificationToggle}
        />
      </div>

      {/* Silence Auto-Stop Toggle */}
      <div className="border border-white/10 rounded-lg bg-white/5 overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex-1">
            <div className="font-medium text-white">Auto-stop on Silence</div>
            <div className="text-sm text-zinc-400">
              Automatically end the recording when no voice is detected for the chosen duration
            </div>
          </div>
          <Switch
            checked={silenceAutoStopEnabled}
            onCheckedChange={handleSilenceToggle}
          />
        </div>

        {/* Duration selector — shown only when the feature is enabled */}
        {silenceAutoStopEnabled && (
          <div className="px-4 pb-4 border-t border-white/10 pt-3">
            <p className="text-xs text-zinc-400 mb-2">Stop recording after this much silence:</p>
            <div className="flex gap-2 flex-wrap">
              {SILENCE_DURATION_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => handleSilenceDurationChange(value)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    silenceTimeoutSecs === value
                      ? 'bg-white text-zinc-900'
                      : 'bg-white/10 text-zinc-300 hover:bg-white/20'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Device Preferences */}
      <div className="space-y-4">
        <div className="border-t border-white/10 pt-6">
          <h4 className="text-base font-medium text-white mb-4">Default Audio Devices</h4>
          <p className="text-sm text-zinc-400 mb-4">
            Set your preferred microphone and system audio devices for recording. These will be automatically selected when starting new recordings.
          </p>

          <div className="border border-white/10 rounded-lg p-4 bg-white/5">
            <DeviceSelection
              selectedDevices={{
                micDevice: preferences.preferred_mic_device,
                systemDevice: preferences.preferred_system_device
              }}
              onDeviceChange={handleDeviceChange}
              disabled={saving}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
