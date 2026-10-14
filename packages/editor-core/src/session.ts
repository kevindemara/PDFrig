export interface SourceReference {
  readonly contentHash: string;
  readonly sourceId: string;
}

export interface EditorCommand<State> {
  readonly id: string;
  readonly version: number;
  apply(state: Readonly<State>): State;
  revert(state: Readonly<State>): State;
}

export interface SessionSnapshot<State> {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly exported: boolean;
  readonly source: SourceReference;
  readonly state: Readonly<State>;
}

/**
 * A PDF-independent command history. It stores state transitions, never source document bytes.
 */
export class DocumentSession<State> {
  readonly #redo: EditorCommand<State>[] = [];
  readonly #source: SourceReference;
  readonly #undo: EditorCommand<State>[] = [];
  #exported = true;
  #state: State;

  public constructor(source: SourceReference, initialState: State) {
    this.#source = Object.freeze({ ...source });
    this.#state = initialState;
  }

  public execute(command: EditorCommand<State>): SessionSnapshot<State> {
    this.#state = command.apply(this.#state);
    this.#undo.push(command);
    this.#redo.length = 0;
    this.#exported = false;
    return this.snapshot();
  }

  public markExported(): SessionSnapshot<State> {
    this.#exported = true;
    return this.snapshot();
  }

  public redo(): SessionSnapshot<State> {
    const command = this.#redo.pop();
    if (command === undefined) return this.snapshot();
    this.#state = command.apply(this.#state);
    this.#undo.push(command);
    this.#exported = false;
    return this.snapshot();
  }

  public snapshot(): SessionSnapshot<State> {
    return Object.freeze({
      canRedo: this.#redo.length > 0,
      canUndo: this.#undo.length > 0,
      exported: this.#exported,
      source: this.#source,
      state: this.#state,
    });
  }

  public undo(): SessionSnapshot<State> {
    const command = this.#undo.pop();
    if (command === undefined) return this.snapshot();
    this.#state = command.revert(this.#state);
    this.#redo.push(command);
    this.#exported = false;
    return this.snapshot();
  }
}
