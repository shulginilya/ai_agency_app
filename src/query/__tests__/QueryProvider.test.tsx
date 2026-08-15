import { focusManager } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { AppState, Platform, Text } from 'react-native';
import { QueryProvider } from '@/query/QueryProvider';

describe('QueryProvider', () => {
  it('renders its children', () => {
    render(
      <QueryProvider>
        <Text>hello</Text>
      </QueryProvider>,
    );
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('forwards AppState to React Query, so returning from the background refetches', () => {
    const setFocused = jest.spyOn(focusManager, 'setFocused');
    const remove = jest.fn();
    let handler: ((status: string) => void) | undefined;
    const addEventListener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_event: string, callback: (status: string) => void) => {
        handler = callback;
        return { remove } as never;
      }) as never);

    const view = render(
      <QueryProvider>
        <Text>hello</Text>
      </QueryProvider>,
    );

    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    handler?.('background');
    expect(setFocused).toHaveBeenLastCalledWith(false);

    handler?.('active');
    expect(setFocused).toHaveBeenLastCalledWith(true);

    view.unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('leaves focus to the browser on web', () => {
    const setFocused = jest.spyOn(focusManager, 'setFocused');
    let handler: ((status: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, cb: (s: string) => void) => {
      handler = cb;
      return { remove: jest.fn() } as never;
    }) as never);
    const platform = jest.replaceProperty(Platform, 'OS', 'web');

    render(
      <QueryProvider>
        <Text>hello</Text>
      </QueryProvider>,
    );
    handler?.('background');

    expect(setFocused).not.toHaveBeenCalled();
    platform.restore();
  });
});
