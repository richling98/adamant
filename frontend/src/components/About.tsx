import React, { useState, useEffect } from "react";
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import Image from 'next/image';
import { UpdateDialog } from "./UpdateDialog";
import { updateService, UpdateInfo } from '@/services/updateService';
import { Button } from './ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';


export function About() {
    const [currentVersion, setCurrentVersion] = useState<string>('0.2.0');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [showUpdateDialog, setShowUpdateDialog] = useState(false);

    useEffect(() => {
        // Get current version on mount
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    const handleContactClick = async () => {
        try {
            await invoke('open_external_url', { url: 'https://adamant.zackriya.com/#about' });
        } catch (error) {
            console.error('Failed to open link:', error);
        }
    };

    const handleCheckForUpdates = async () => {
        setIsChecking(true);
        try {
            const info = await updateService.checkForUpdates(true);
            setUpdateInfo(info);
            if (info.available) {
                setShowUpdateDialog(true);
            } else {
                toast.success('You are running the latest version');
            }
        } catch (error: any) {
            console.error('Failed to check for updates:', error);
            toast.error('Failed to check for updates: ' + (error.message || 'Unknown error'));
        } finally {
            setIsChecking(false);
        }
    };

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
                        onClick={handleCheckForUpdates}
                        disabled={isChecking}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                    >
                        {isChecking ? (
                            <>
                                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                Checking...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="h-3 w-3 mr-2" />
                                Check for Updates
                            </>
                        )}
                    </Button>
                    {updateInfo?.available && (
                        <div className="mt-2 text-xs text-blue-600">
                            Update available: v{updateInfo.version}
                        </div>
                    )}
                </div>
            </div>

            {/* Features Grid - Compact */}
            <div className="space-y-3">
                <h2 className="text-base font-semibold text-zinc-200">What makes Adamant different</h2>
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/5 rounded p-3 hover:bg-white/10 transition-colors">
                        <h3 className="font-bold text-sm text-white mb-1">Privacy-first</h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">Your data & AI processing workflow can now stay within your premise. No cloud, no leaks.</p>
                    </div>
                    <div className="bg-white/5 rounded p-3 hover:bg-white/10 transition-colors">
                        <h3 className="font-bold text-sm text-white mb-1">Use Any Model</h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">Prefer local open-source model? Great. Want to plug in an external API? Also fine. No lock-in.</p>
                    </div>
                    <div className="bg-white/5 rounded p-3 hover:bg-white/10 transition-colors">
                        <h3 className="font-bold text-sm text-white mb-1">Cost-Smart</h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">Avoid pay-per-minute bills by running models locally (or pay only for the calls you choose).</p>
                    </div>
                    <div className="bg-white/5 rounded p-3 hover:bg-white/10 transition-colors">
                        <h3 className="font-bold text-sm text-white mb-1">Works everywhere</h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">Google Meet, Zoom, Teams-online or offline.</p>
                    </div>
                </div>
            </div>

            {/* Coming Soon - Compact */}
            <div className="bg-blue-900/20 rounded p-3">
                <p className="text-s text-blue-300">
                    <span className="font-bold">Coming soon:</span> A library of on-device AI agents-automating follow-ups, action tracking, and more.
                </p>
            </div>

            {/* CTA Section - Compact */}
            <div className="text-center space-y-2">
                <h3 className="text-medium font-semibold text-zinc-200">Ready to push your business further?</h3>
                <p className="text-s text-zinc-400">
                    If you're planning to build privacy-first custom AI agents or a fully tailored product for your <span className="font-bold">business</span>, we can help you build it.
                </p>
                <button
                    onClick={handleContactClick}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors duration-200 shadow-sm hover:shadow-md"
                >
                    Chat with the Zackriya team
                </button>
            </div>

            {/* Footer - Compact */}
            <div className="pt-2 border-t border-white/10 text-center">
                <p className="text-xs text-zinc-500">
                    Built by Zackriya Solutions
                </p>
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
