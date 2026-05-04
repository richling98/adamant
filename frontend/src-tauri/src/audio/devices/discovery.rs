use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};

use super::configuration::{AudioDevice, DeviceType};
use super::platform;

/// List all available audio devices on the system
pub async fn list_audio_devices() -> Result<Vec<AudioDevice>> {
    let host = cpal::default_host();

    // Platform-specific device enumeration
    let mut devices = {
        #[cfg(target_os = "windows")]
        {
            platform::configure_windows_audio(&host)?
        }

        #[cfg(target_os = "linux")]
        {
            platform::configure_linux_audio(&host)?
        }

        #[cfg(target_os = "macos")]
        {
            platform::configure_macos_audio(&host)?
        }
    };

    // Add any additional devices from the default host
    if let Ok(other_devices) = host.devices() {
        for device in other_devices {
            if let Ok(name) = device.name() {
                if !devices.iter().any(|d| d.name == name) {
                    devices.push(AudioDevice::new(name, DeviceType::Output));
                }
            }
        }
    }

    Ok(devices)
}

/// Query the macOS microphone authorization status via AVCaptureDevice.
/// Returns the raw AVAuthorizationStatus integer:
///   0 = NotDetermined, 1 = Restricted, 2 = Denied, 3 = Authorized
#[cfg(target_os = "macos")]
fn get_macos_mic_auth_status() -> i64 {
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CString;
    unsafe {
        // AVMediaTypeAudio is the NSString constant "soun"
        let c_str = CString::new("soun").expect("CString::new failed");
        let media_type: *mut objc::runtime::Object =
            msg_send![class!(NSString), stringWithUTF8String: c_str.as_ptr()];
        let status: i64 =
            msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: media_type];
        status
    }
}

/// Ask macOS to authorize microphone access for this exact app identity.
/// This creates the TCC Privacy entry for dev builds, even before Settings is opened.
#[cfg(target_os = "macos")]
fn request_macos_mic_access() -> Result<bool> {
    use block::ConcreteBlock;
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CString;
    use std::sync::mpsc;
    use std::time::Duration;

    let (tx, rx) = mpsc::channel();
    let completion = ConcreteBlock::new(move |granted: bool| {
        let _ = tx.send(granted);
    })
    .copy();

    unsafe {
        let c_str = CString::new("soun").expect("CString::new failed");
        let media_type: *mut objc::runtime::Object =
            msg_send![class!(NSString), stringWithUTF8String: c_str.as_ptr()];
        let _: () = msg_send![
            class!(AVCaptureDevice),
            requestAccessForMediaType: media_type
            completionHandler: &*completion
        ];
    }

    Ok(rx.recv_timeout(Duration::from_secs(60)).unwrap_or(false))
}

/// Check microphone permission status without triggering a dialog or sleeping.
/// Returns Ok(true) if the mic is accessible right now, Ok(false) if not.
pub fn check_microphone_permission() -> Result<bool> {
    #[cfg(target_os = "macos")]
    return Ok(get_macos_mic_auth_status() == 3); // 3 = AVAuthorizationStatusAuthorized

    #[cfg(not(target_os = "macos"))]
    {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => return Ok(false),
        };
        match device.default_input_config() {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
}

/// Trigger audio permission request on platforms that require it.
/// Returns Ok(true) if permission is granted, Ok(false) if denied, Err if something went wrong.
pub fn trigger_audio_permission() -> Result<bool> {
    use log::info;

    #[cfg(target_os = "macos")]
    {
        let status = get_macos_mic_auth_status();
        return match status {
            3 => {
                info!("[trigger_audio_permission] Microphone already authorized");
                Ok(true)
            }
            1 | 2 => {
                // Restricted or Denied — macOS will not show the dialog again.
                // User must re-enable in System Settings → Privacy & Security → Microphone.
                info!("[trigger_audio_permission] Microphone access denied/restricted — user must enable in System Settings");
                Ok(false)
            }
            _ => {
                // NotDetermined (0) — explicitly request access so macOS creates a
                // Privacy & Security → Microphone entry for this dev app identity.
                info!("[trigger_audio_permission] Status NotDetermined — requesting microphone access...");
                let granted = request_macos_mic_access()?;
                let final_status = get_macos_mic_auth_status();
                info!(
                    "[trigger_audio_permission] Native microphone request result: {}, final status: {}",
                    granted, final_status
                );
                Ok(granted && final_status == 3)
            }
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        use cpal::traits::StreamTrait;
        use log::error;

        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                info!("[trigger_audio_permission] No default input device found - permission likely denied");
                return Ok(false);
            }
        };

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                info!("[trigger_audio_permission] Failed to get input config: {} - permission likely denied", e);
                return Ok(false);
            }
        };

        let stream = match device.build_input_stream(
            &config.into(),
            |_data: &[f32], _: &cpal::InputCallbackInfo| {},
            |err| error!("Error in audio stream: {}", err),
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                info!("[trigger_audio_permission] Failed to build input stream: {} - permission likely denied", e);
                return Ok(false);
            }
        };

        if let Err(e) = stream.play() {
            info!("[trigger_audio_permission] Failed to play stream: {} - permission likely denied", e);
            return Ok(false);
        }

        drop(stream);

        info!("[trigger_audio_permission] Stream played successfully - permission granted");
        Ok(true)
    }
}
