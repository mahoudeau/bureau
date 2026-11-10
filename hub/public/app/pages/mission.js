import { placeholder } from '../ui.js';

export function render(ctx) {
  ctx.title(ctx.params.id);
  return placeholder(`Mission ${ctx.params.id}`);
}
