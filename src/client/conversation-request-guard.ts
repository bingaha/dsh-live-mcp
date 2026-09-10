/**
 * Monotonic request tokens for one conversation capability view.
 *
 * A response may update the view only while its context identity and operation
 * token still match the most recently issued request.
 */
export class ConversationRequestGuard {
  private identity = ''
  private version = 0

  /**
   * Start an operation for one session/workspace context.
   * @param identity - stable session and cwd identity.
   * @returns token that permits this operation's response to update the view.
   */
  begin(identity: string): number {
    this.identity = identity
    return ++this.version
  }

  /**
   * Check whether a response still belongs to the most recent operation.
   * @param identity - operation session and cwd identity.
   * @param version - token returned by {@link begin}.
   * @returns whether the response may update visible state.
   */
  isCurrent(identity: string, version: number): boolean {
    return this.identity === identity && this.version === version
  }
}
