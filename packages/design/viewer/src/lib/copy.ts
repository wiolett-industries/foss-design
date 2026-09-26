import { toast } from '../ui/toast'

export async function copyText(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast(label, text.length > 64 ? undefined : text)
  } catch {
    toast('Could not copy', 'The browser blocked clipboard access')
  }
}
