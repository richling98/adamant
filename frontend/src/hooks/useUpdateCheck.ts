import { useCallback, useEffect, useState } from 'react';
import { updateService, UpdateInfo } from '@/services/updateService';
import { showUpdateNotification } from '@/components/UpdateNotification';

interface UseUpdateCheckOptions {
  checkOnMount?: boolean;
  showNotification?: boolean;
  onUpdateAvailable?: (info: UpdateInfo) => void;
}

export function useUpdateCheck(options: UseUpdateCheckOptions = {}) {
  const {
    checkOnMount = true,
    showNotification = true,
    onUpdateAvailable,
  } = options;

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async (force = false) => {
    // Skip if checked recently (unless forced)
    if (!force && updateService.wasCheckedRecently()) {
      return;
    }

    setIsChecking(true);
    setCheckError(null);
    try {
      const info = await updateService.checkForUpdates(force);
      setUpdateInfo(info);
      setHasChecked(true);

      if (info.available) {
        if (onUpdateAvailable) {
          onUpdateAvailable(info);
        } else if (showNotification) {
          showUpdateNotification(info, () => {
            // This will be handled by the component that uses this hook
          });
        }
      }
    } catch (error) {
      // Silently fail on startup checks to avoid disrupting user experience
      setHasChecked(true);
      setCheckError(error instanceof Error ? error.message : 'Failed to check for updates');
      if (force) {
        console.warn('Failed to check for updates:', error);
      } else {
        console.debug('Startup update check skipped or failed:', error);
      }
    } finally {
      setIsChecking(false);
    }
  }, [onUpdateAvailable, showNotification]);

  useEffect(() => {
    if (checkOnMount) {
      // Delay the check slightly to avoid blocking app startup
      const timer = setTimeout(() => {
        checkForUpdates(false);
      }, 2000); // Check 2 seconds after mount

      return () => clearTimeout(timer);
    }
  }, [checkOnMount, checkForUpdates]);

  return {
    updateInfo,
    isChecking,
    hasChecked,
    checkError,
    checkForUpdates,
  };
}
