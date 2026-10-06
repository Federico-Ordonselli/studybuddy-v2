export function element(tag: string, attrs?: Record<string, unknown>, ...children: (Node | string | null | undefined)[]): HTMLElement;
export function button(text: string, action: () => unknown, attrs?: Record<string, unknown>): HTMLButtonElement;
export function field(label: string, input: HTMLElement): HTMLLabelElement;
export function download(name: string, text: string, type: string): void;
