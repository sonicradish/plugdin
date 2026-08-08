import Enquirer from "enquirer";
import type { Prompter, SelectOption, ToggleItem } from "./prompter.js";

/**
 * Real arrow-key-driven prompts via `enquirer` (zero runtime deps of its own). Confirmed
 * against its source (`lib/types/array.js`): a `select` resolves to the focused choice's
 * `name`, a `multiselect` resolves to an array of the checked choices' `name`s — so choices
 * are built as `{ name: <our value>, message: <our label> }` throughout, and the resolved
 * `value` field is exactly what SelectOption.value / ToggleItem.key already is.
 */
export class EnquirerPrompter implements Prompter {
  note(message: string): void {
    console.log(message);
  }

  async select(message: string, options: readonly SelectOption[]): Promise<string> {
    const { value } = await Enquirer.prompt<{ value: string }>({
      type: "select",
      name: "value",
      message,
      choices: options.map((o) => ({ name: o.value, message: o.label })),
    });
    return value;
  }

  async input(message: string): Promise<string> {
    const { value } = await Enquirer.prompt<{ value: string }>({
      type: "input",
      name: "value",
      message,
    });
    return value;
  }

  async confirm(message: string, defaultValue: boolean): Promise<boolean> {
    const { value } = await Enquirer.prompt<{ value: boolean }>({
      type: "confirm",
      name: "value",
      message,
      initial: defaultValue,
    });
    return value;
  }

  async toggleList(message: string, items: readonly ToggleItem[]): Promise<ReadonlySet<string>> {
    // Per-choice `enabled` looks like the pre-check mechanism and IS in enquirer's own type
    // declarations, but `ArrayPrompt.reset()` (lib/types/array.js) unconditionally zeroes
    // every choice's `enabled` right after building them, and only an array passed as the
    // top-level `initial` option survives — confirmed by reading the source after a live
    // pty test showed every item starting unchecked regardless of `enabled`. The shipped
    // .d.ts also only types `initial` as a single `number`, not the array the runtime
    // actually accepts for a multiselect, hence the cast below.
    const options = {
      type: "multiselect",
      name: "value",
      message: `${message} (space to toggle, enter to accept)`,
      choices: items.map((i) => ({ name: i.key, message: i.label })),
      initial: items.filter((i) => i.initiallyOn).map((i) => i.key),
    };
    const { value } = await Enquirer.prompt<{ value: string[] }>(options as Parameters<typeof Enquirer.prompt>[0]);
    return new Set(value);
  }

  close(): void {}
}
