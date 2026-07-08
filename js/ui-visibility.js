export function enableUiVisibility(root = document) {
  const hideButton = root.querySelector('[data-hide-ui]');
  const showButton = root.querySelector('[data-show-ui]');

  hideButton?.addEventListener('click', () => {
    document.body.classList.add('ui-hidden');
  });

  showButton?.addEventListener('click', () => {
    document.body.classList.remove('ui-hidden');
  });
}
