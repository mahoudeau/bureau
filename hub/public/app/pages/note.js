import { placeholder } from '../ui.js';

export function render(ctx) {
  ctx.title(ctx.params.path);
  return placeholder(ctx.params.path);
}
