import React, { useState, useEffect } from "react";
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import Image from 'next/image';
import { UpdateDialog } from "./UpdateDialog";
import { updateService, UpdateInfo } from '@/services/updateService';
import { Button } from './ui/button';
import { CheckCircle2, Shield, Cpu, CircleDollarSign, Globe } from 'lucide-react';


export function About() {
    const [currentVersion, setCurrentVersion] = useState<string>('0.2.0');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [showUpdateDialog, setShowUpdateDialog] = useState(false);

    useEffect(() => {
        // Get current version on mount
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    const features = [
        { icon: Shield, title: 'Privacy-first', description: 'Everything stays on your machine. No cloud uploads, no data leaks.' },
        { icon: Cpu, title: 'Local AI models', description: 'Open-source models run entirely on your hardware. You own it.' },
        { icon: CircleDollarSign, title: 'No token costs', description: 'No subscriptions, no API bills. Run it forever for free.' },
        { icon: Globe, title: 'Works everywhere', description: 'Google Meet, Zoom, Teams — online or offline.' },
    ];

    return (
        <div className="py-6 space-y-8 max-w-lg">
            {/* Header */}
            <div className="flex items-center gap-5">
                <Image
                    src="/logo.png"
                    alt="Adamant Logo"
                    width={52}
                    height={52}
                    className="object-contain flex-shrink-0"
                />
                <div>
                    <p className="text-white font-semibold text-base leading-snug">Real-time notes and summaries<br />that never leave your machine.</p>
                    <span className="text-xs text-zinc-500 mt-1 block">v{currentVersion}</span>
                </div>
            </div>

            {/* Update button */}
            <Button
                onClick={() => invoke('open_external_url', { url: 'https://github.com/richling98/adamant/releases' })}
                variant="outline"
                size="sm"
                className="text-xs w-full justify-center"
            >
                <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                Check for Updates
            </Button>

            {/* Features list */}
            <div className="space-y-1">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">What makes Adamant different</p>
                {features.map(({ icon: Icon, title, description }) => (
                    <div key={title} className="flex items-start gap-4 py-3 border-b border-white/5 last:border-0">
                        <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-md bg-white/5 flex items-center justify-center">
                            <Icon className="w-3.5 h-3.5 text-zinc-400" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-white">{title}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Update Dialog */}
            <UpdateDialog
                open={showUpdateDialog}
                onOpenChange={setShowUpdateDialog}
                updateInfo={updateInfo}
            />
        </div>
    )
}
