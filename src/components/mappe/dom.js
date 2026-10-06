/* Tutti i contenuti importati entrano come testo, mai come HTML. */
export function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter(c => c != null));
  return node;
}
export const button = (text, action, attrs = {}) => element('button', { type: 'button', text, onclick: action, ...attrs });
export function field(label, input) { return element('label', { class: 'studio-field' }, element('span', { text: label }), input); }
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = element('a', { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
