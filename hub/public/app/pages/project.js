import { placeholder } from '../ui.js';

export function render(ctx) {
  ctx.title(ctx.params.id);
  return placeholder(`Project ${ctx.params.id}`);
}
