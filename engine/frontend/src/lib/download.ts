/**
 * Hands a file the page already holds (a CSV from the backend) to the browser to save. A short-lived
 * object URL on a link that is clicked once, then let go.
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers read the file a little after the click, so the URL is let go later, not at once.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 30_000)
}
