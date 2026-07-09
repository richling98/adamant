/**
 * Update Service
 *
 * Handles automatic software updates using Tauri updater plugin.
 * Provides update checking, downloading, and installation functionality.
 */

import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  date?: string;
  body?: string;
  downloadUrl?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export interface UpdateFetchResult {
  info: UpdateInfo;
  update: Update | null;
}

/**
 * Update Service
 * Singleton service for managing app updates
 */
export class UpdateService {
  private updateCheckInProgress = false;
  private lastCheckTime: number | null = null;
  private readonly CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  private async fetchUpdateStatus(force = false): Promise<UpdateFetchResult> {
    // Prevent concurrent update checks
    if (this.updateCheckInProgress) {
      throw new Error('Update check already in progress');
    }

    const currentVersion = await getVersion();

    // Tauri dev builds do not have a useful production update feed. Skipping
    // avoids noisy startup console errors from the updater plugin in dev mode.
    if (process.env.NODE_ENV === 'development') {
      console.debug('Skipping update check in development mode');
      return {
        info: {
          available: false,
          currentVersion,
        },
        update: null,
      };
    }

    // Skip if checked recently (unless forced)
    if (!force && this.lastCheckTime) {
      const timeSinceLastCheck = Date.now() - this.lastCheckTime;
      if (timeSinceLastCheck < this.CHECK_INTERVAL_MS) {
        console.debug('Skipping update check - checked recently');
        return {
          info: {
            available: false,
            currentVersion,
          },
          update: null,
        };
      }
    }

    this.updateCheckInProgress = true;
    this.lastCheckTime = Date.now();

    try {
      const update = await check();

      if (update?.available) {
        return {
          info: {
            available: true,
            currentVersion,
            version: update.version,
            date: update.date,
            body: update.body,
          },
          update,
        };
      }

      return {
        info: {
          available: false,
          currentVersion,
        },
        update: null,
      };
    } catch (error) {
      console.error('Failed to check for updates:', error);
      throw error;
    } finally {
      this.updateCheckInProgress = false;
    }
  }

  /**
   * Check for available updates
   * @param force Force check even if recently checked
   * @returns Promise with update information
   */
  async checkForUpdates(force = false): Promise<UpdateInfo> {
    const { info } = await this.fetchUpdateStatus(force);
    return info;
  }

  /**
   * Download and install the available update
   * @param update The update object from checkForUpdates
   * @param onProgress Optional progress callback
   * @returns Promise that resolves when download completes
   */
  async downloadAndInstall(
    update: Update,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<void> {
    try {
      let downloaded = 0;
      let total = 0;

      await update.downloadAndInstall((event) => {
        if (!onProgress) {
          return;
        }

        switch (event.event) {
          case 'Started':
            total = event.data.contentLength || 0;
            downloaded = 0;
            onProgress({ downloaded, total, percentage: 0 });
            break;
          case 'Progress': {
            downloaded += event.data.chunkLength || 0;
            onProgress({
              downloaded,
              total,
              percentage: total > 0 ? Math.round((downloaded / total) * 100) : 0,
            });
            break;
          }
          case 'Finished':
            onProgress({
              downloaded: total,
              total,
              percentage: 100,
            });
            break;
        }
      });

      await relaunch();
    } catch (error) {
      console.error('Failed to download/install update:', error);
      throw error;
    }
  }

  /**
   * Check for a newer release and install it immediately.
   * @param force Force a fresh check before downloading
   * @param onProgress Optional progress callback
   */
  async installAvailableUpdate(
    force = true,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<UpdateInfo> {
    const { info, update } = await this.fetchUpdateStatus(force);

    if (!info.available || !update) {
      throw new Error('No update available');
    }

    await this.downloadAndInstall(update, onProgress);
    return info;
  }

  /**
   * Get the current app version
   * @returns Promise with version string
   */
  async getCurrentVersion(): Promise<string> {
    return getVersion();
  }

  /**
   * Check if an update check was performed recently
   * @returns true if checked within the interval
   */
  wasCheckedRecently(): boolean {
    if (!this.lastCheckTime) return false;
    const timeSinceLastCheck = Date.now() - this.lastCheckTime;
    return timeSinceLastCheck < this.CHECK_INTERVAL_MS;
  }
}

// Export singleton instance
export const updateService = new UpdateService();
