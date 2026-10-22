// Every id the editor looks up is a toolbar control (input, select, button) or
// a plain container, and every selector it queries matches HTML elements. So
// lookups are typed that way: the check stays focused on what matters here —
// misspelled names, wrong arguments, missing fields — instead of a cast on
// every toolbar line.
interface Document {
  getElementById(elementId: string): HTMLInputElement;
}
interface ParentNode {
  querySelector(selectors: string): HTMLElement | null;
  querySelectorAll(selectors: string): NodeListOf<HTMLElement>;
}
interface Element {
  closest(selectors: string): HTMLElement | null;
}
