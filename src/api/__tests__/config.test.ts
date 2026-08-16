import { normalizeBaseUrl, resolveBaseUrl } from '@/api/config';

describe('resolveBaseUrl', () => {
  it('prefers EXPO_PUBLIC_API_URL over everything else', () => {
    expect(resolveBaseUrl({ envUrl: 'https://api.example.com', hostUri: '10.0.0.5:8081', platform: 'android' })).toBe(
      'https://api.example.com',
    );
  });

  it('trims the trailing slash so paths join cleanly', () => {
    expect(resolveBaseUrl({ envUrl: 'http://localhost:9000///' })).toBe('http://localhost:9000');
  });

  it('ignores a blank env value', () => {
    expect(resolveBaseUrl({ envUrl: '   ', platform: 'ios' })).toBe('http://localhost:8000');
  });

  it('reuses the Metro LAN host for physical devices', () => {
    expect(resolveBaseUrl({ hostUri: '192.168.1.24:8081', platform: 'ios' })).toBe('http://192.168.1.24:8000');
  });

  it('does not treat a loopback Metro host as a LAN host', () => {
    expect(resolveBaseUrl({ hostUri: 'localhost:8081', platform: 'ios' })).toBe('http://localhost:8000');
    expect(resolveBaseUrl({ hostUri: '127.0.0.1:8081', platform: 'android' })).toBe('http://10.0.2.2:8000');
  });

  it('uses the 10.0.2.2 alias on the Android emulator', () => {
    expect(resolveBaseUrl({ platform: 'android' })).toBe('http://10.0.2.2:8000');
  });

  it('uses localhost on web and iOS simulators', () => {
    expect(resolveBaseUrl({ platform: 'web' })).toBe('http://localhost:8000');
    expect(resolveBaseUrl({ platform: 'ios' })).toBe('http://localhost:8000');
  });

  it('honours a custom port', () => {
    expect(resolveBaseUrl({ platform: 'web', port: 9100 })).toBe('http://localhost:9100');
  });
});

describe('normalizeBaseUrl', () => {
  it('strips whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl('  http://localhost:8000/ ')).toBe('http://localhost:8000');
  });
});
