import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

export async function openListing(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}
