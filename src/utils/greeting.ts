/**
 * Greeting utility - Simple greeting function
 */

/**
 * Returns a greeting message for the given name
 * @param name - The name to greet
 * @returns A greeting string in the format "Hello, {name}!"
 * @example
 * greet('World') // returns 'Hello, World!'
 */
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
