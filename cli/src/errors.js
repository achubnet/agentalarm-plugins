export const EXIT = Object.freeze({
  OK: 0,
  FAILURE: 1, // network, server or local file problem
  USAGE: 2, // bad arguments
  AUTH: 3, // not logged in, key rejected or read-only
  REFUSED: 4, // the server refused the alert (limits, validation): its message is printed
});

/** An error with a message for the user (never a stack trace) and the exit code to use. */
export class CliError extends Error {
  constructor(message, exitCode = EXIT.FAILURE) {
    super(message);
    this.exitCode = exitCode;
  }
}
