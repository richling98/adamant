import React, { useState, useEffect } from "react";
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import Image from 'next/image';
import { UpdateDialog } from "./UpdateDialog";
import { updateService, UpdateInfo } from '@/services/updateService';
import { Button } from './ui/button';
import { CheckCircle2 } from 'lucide-react';


export function About() {
    const [currentVersion, setCurrentVersion] = useState<string>('0.2.0');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [showUpdateDialog, setShowUpdateDialog] = useState(false);

    useEffect(() => {
        // Get current version on mount
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    return (
        <div className="p-4 space-y-4 h-[80vh] overflow-y-auto">
            {/* Compact Header */}
            <div className="text-center">
                <div className="mb-3">
                    <Image
                        src="/logo.png"
                        alt="Adamant Logo"
                        width={64}
                        height={64}
                        className="mx-auto object-contain"
                    />
                </div>
                {/* <h1 className="text-xl font-bold text-gray-900">Adamant</h1> */}
                <span className="text-sm text-zinc-400"> v{currentVersion}</span>
                <p className="text-medium text-zinc-400 mt-1">
                    Real-time notes and summaries that never leave your machine.
                </p>
                <div className="mt-3">
                    <Button
                        onClick={() => invoke('open_external_url', { url: 'https://github.com/richling98/adamant/releases' })}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                    >
                        <CheckCircle2 className="h-3 w-3 mr-2" />
                        Check for Updates
                    </Button>
                </div>
            </div>

            {/* Features Grid - Compact */}
            <div className="space-y-3">
                <h2 className="text-base font-semibold text-zinc-200">What makes Adamant different</h2>
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/5 rounded p-3 hover:bg-white/10 transition-colors">
                        <h3 className="font-bold text-sm text-white mb-1">Privacy-first</h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">Your meeting notes and AI processing workflows stay on your machine. No cloud, no leaks.</p>
                    </div>
                    <div className="bg-white/5 rounded p-3 hover:bg-white/10 transition-colors">
                        <h3 className="font-bold text-sm text-white mb-1">Smart, local models</h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">Use local, open-source models for AI processing. You own the model directly on your machine.</p>
                    </div>
                    <div className="bg-white/5 rounded p-3 hover:bg-white/10 transition-colors">
                        <h3 className="font-bold text-sm text-white mb-1">No token costs</h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">Say goodbye to LLM token costs. Your local AI model runs on your machine, no strings attached.</p>
                    </div>
                    <div className="bg-white/5 rounded p-3 hover:bg-white/10 transition-colors">
                        <h3 className="font-bold text-sm text-white mb-1">Works everywhere</h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">Google Meet, Zoom, Teams-online or offline.</p>
                    </div>
                </div>
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
