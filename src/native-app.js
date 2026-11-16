import { Capacitor, SystemBars } from '@capacitor/core';
import { App } from '@capacitor/app';

export async function bindNativeApp({ onBack, onActive }) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handles = [];
  const hideBars = () => SystemBars.hide().catch(error => console.warn('System bars:', error));
  handles.push(await App.addListener('backButton', () => {
    Promise.resolve(onBack()).then(handled => { if (!handled) return App.minimizeApp(); })
      .catch(error => console.error('Android back:', error));
  }));
  handles.push(await App.addListener('appStateChange', ({ isActive }) => {
    onActive(isActive);
    if (isActive) hideBars();
  }));
  onActive((await App.getState()).isActive);
  await hideBars();
  return () => { for (const handle of handles) handle.remove(); };
}
