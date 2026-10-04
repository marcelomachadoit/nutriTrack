async function initializeApp() {
  const redirect = readAuthRedirect();
  // Link expirado ou recusado: explica em vez de cair na tela de login sem dizer nada.
  if (redirect.error) {
    openAuthModal('login');
    document.querySelector('#auth-feedback').textContent = translateRedirectError(redirect.error);
    clearAuthRedirect();
    return;
  }
  if (redirect.type === 'recovery') {
    openAuthModal('reset');
    return;
  }
  const user = await getCurrentUser();
  if (!user) {
    openAuthModal();
    return;
  }
  showAuthenticatedApp(user);
  renderSelectedDate();
  // O perfil vem primeiro: é dele que saem as metas usadas no resumo do dia.
  await loadNutritionProfile().catch(() => showToast(t('Não foi possível carregar seu perfil.'), 'error'));
  // Cada carga falha por conta própria: um erro em uma seção não deixa o resto da tela vazio.
  await Promise.all([
    loadFoodCatalog().catch(() => showToast(t('Não foi possível carregar os alimentos.'), 'error')),
    loadRecipes().catch(() => showToast(t('Não foi possível carregar suas receitas.'), 'error')),
    refreshDashboard().catch(() => showToast(t('Não foi possível carregar suas refeições.'), 'error')),
    loadWeight().catch(() => showToast(t('Não foi possível carregar seu histórico de peso.'), 'error')),
    loadFitData().catch((error) => showToast(t('Não foi possível carregar seus treinos. {0}', describeDatabaseError(error)), 'error')),
  ]);
  appReady = true;
  // Conta nova ou perfil incompleto: o questionário abre e não pode ser dispensado.
  if (!isProfileComplete(nutritionProfile)) openGoalsDialog(true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=35').catch(() => {});
}

// CSS e JS vêm do cache primeiro. Quando um service worker novo assume a página, os
// arquivos em uso ainda são os antigos: recarrega uma vez para a correção entrar na hora,
// em vez de só na próxima abertura. Na primeira visita não havia controlador, então não
// recarrega à toa.
if ('serviceWorker' in navigator) {
  const tinhaControlador = Boolean(navigator.serviceWorker.controller);
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaControlador || recarregou) return;
    recarregou = true;
    window.location.reload();
  });
}

// Avisa uma vez, depois que a tela já decidiu o que mostrar.
function reportFileProtocol() {
  if (!isFileProtocol()) return;
  document.querySelector('#auth-feedback').textContent = t(FILE_PROTOCOL_MESSAGE);
  showToast(t('Abra o app por um servidor local, não pelo arquivo.'), 'error');
}

document.addEventListener('DOMContentLoaded', () => initializeApp()
  .then(reportFileProtocol)
  .catch(() => {
    document.querySelector('#auth-feedback').textContent = t('Não foi possível carregar o aplicativo. Tente novamente.');
  }));
