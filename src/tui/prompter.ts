export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface ToggleItem {
  readonly key: string;
  readonly label: string;
  readonly initiallyOn: boolean;
}

/**
 * Everything the interactive Profile picker/wizard needs from a terminal, abstracted so
 * `pick-profile.ts` is testable with a scripted fake instead of a real TTY.
 */
export interface Prompter {
  select(message: string, options: readonly SelectOption[]): Promise<string>;
  input(message: string): Promise<string>;
  confirm(message: string, defaultValue: boolean): Promise<boolean>;
  /** Shows items with their starting on/off state; returns the final set of "on" keys once
   * the user accepts (blank input). */
  toggleList(message: string, items: readonly ToggleItem[]): Promise<ReadonlySet<string>>;
  note(message: string): void;
  close(): void;
}
