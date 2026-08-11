import type { Prompter, SelectOption, ToggleItem } from "../../src/tui/prompter.js";

/**
 * Scripted Prompter for testing the interactive Profile wizard without a real TTY. Queue
 * responses in the exact order the flow under test will ask for them; each call type has
 * its own queue so a wrong-typed response fails loudly instead of silently misinterpreting.
 */
export class FakePrompter implements Prompter {
  private selectAnswers: string[] = [];
  private inputAnswers: string[] = [];
  private confirmAnswers: boolean[] = [];
  private toggleAnswers: Array<ReadonlySet<string>> = [];
  readonly notes: string[] = [];
  readonly selectPrompts: Array<{ message: string; options: readonly SelectOption[] }> = [];
  readonly toggleListPrompts: Array<{ message: string; items: readonly ToggleItem[] }> = [];

  queueSelect(...answers: string[]): this {
    this.selectAnswers.push(...answers);
    return this;
  }
  queueInput(...answers: string[]): this {
    this.inputAnswers.push(...answers);
    return this;
  }
  queueConfirm(...answers: boolean[]): this {
    this.confirmAnswers.push(...answers);
    return this;
  }
  queueToggleResult(...answers: Array<ReadonlySet<string>>): this {
    this.toggleAnswers.push(...answers);
    return this;
  }

  async select(message: string, options: readonly SelectOption[]): Promise<string> {
    this.selectPrompts.push({ message, options });
    const next = this.selectAnswers.shift();
    if (next === undefined) throw new Error(`FakePrompter.select called with no queued answer for: ${message}`);
    return next;
  }

  async input(message: string): Promise<string> {
    const next = this.inputAnswers.shift();
    if (next === undefined) throw new Error(`FakePrompter.input called with no queued answer for: ${message}`);
    return next;
  }

  async confirm(message: string, defaultValue: boolean): Promise<boolean> {
    const next = this.confirmAnswers.shift();
    return next ?? defaultValue;
  }

  async toggleList(message: string, items: readonly ToggleItem[]): Promise<ReadonlySet<string>> {
    this.toggleListPrompts.push({ message, items });
    const next = this.toggleAnswers.shift();
    if (next === undefined) return new Set(items.filter((i) => i.initiallyOn).map((i) => i.key));
    return next;
  }

  note(message: string): void {
    this.notes.push(message);
  }

  close(): void {}
}
