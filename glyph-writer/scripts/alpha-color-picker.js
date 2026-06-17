// Simple alpha-aware color picker helper.
// Keeps the alpha label in sync and invokes an optional callback on change.

export function initAlphaColorPicker({
  colorInputId,
  alphaInputId,
  alphaLabelId,
  onChange
}) {
  const colorInput = document.getElementById(colorInputId);
  const alphaInput = document.getElementById(alphaInputId);
  const alphaLabel = document.getElementById(alphaLabelId);

  const update = () => {
    const color = colorInput?.value || '#000000';
    const alphaRaw = parseFloat(alphaInput?.value ?? '1');
    // Interpret slider as transparency: 0 = opaque, 1 = fully transparent.
    const alpha = 1 - clamp(alphaRaw, 0, 1);
    if (alphaLabel) alphaLabel.textContent = `${Math.round((1 - alpha) * 100)}%`;
    if (alphaInput && alphaInput.value !== alphaRaw.toString()) {
      alphaInput.value = alphaRaw.toString();
    }
    onChange?.({ color, alpha });
  };

  colorInput?.addEventListener('input', update);
  alphaInput?.addEventListener('input', update);

  update();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
