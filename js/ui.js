const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
const THEME_KEY = 'nutritrack-theme';
const FOOD_PAGE_SIZE = 60;

let foodCatalog = [];
let editingFoodId = null;
let recipeDraft = { id: null, items: [] };
let recipeQuantityTouched = false;
let selectedDate = todayKey();
let weekStart = weekStartKey(selectedDate);
let weekDays = [];
let weekFocus = null;
let calendarMonth = null;
let calendarRequest = 0;
// Vira true quando a primeira carga termina; antes disso não há o que redesenhar.
let appReady = false;
let weightLogs = [];
let weightRange = '30';
let mealSlots = [];
let slotDraft = [];
let recipeList = [];
let entryMode = 'food';
let entryQuantityTouched = false;
let nutritionProfile = null;
let goalStep = 0;
let goalDraft = {};
let goalsMandatory = false;

const GOAL_STEPS = 6;
// Usadas enquanto o usuario nao respondeu ao questionario.
const DEFAULT_GOALS = { calories: 2400, protein: 170, carbohydrates: 250, fat: 70 };

function createIcon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

function createIconButton(icon, className, label, onClick) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(createIcon(icon));
  button.addEventListener('click', onClick);
  return button;
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

function toggleTheme() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme || (prefersDark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  showToast(next === 'dark' ? t('Tema escuro ativado.') : t('Tema claro ativado.'));
}

function showView(viewName) {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === viewName));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.target === viewName));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // FitTrack (fit-ui.js): mantém a barra e a navegação do app a que a tela pertence.
  onViewShown(viewName);
  if (viewName === 'progresso') {
    loadWeek().catch((error) => showToast(t('Não foi possível carregar a semana. {0}', describeDatabaseError(error)), 'error'));
    loadWeight().catch((error) => showToast(t('Não foi possível carregar o peso. {0}', describeDatabaseError(error)), 'error'));
  }
}

function showToast(message, type = '') {
  const toast = document.querySelector('.toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.className = 'toast'; }, 2800);
}

function formatNumber(value) {
  return new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 1 }).format(value || 0);
}

function baseUnitOf(food) {
  const unit = food && food.base_unit;
  if (unit === 'ml') return 'ml';
  if (unit === 'un') return 'un';
  return 'g';
}

function baseAmountOf(food) {
  const amount = Number(food && food.serving_size);
  return amount > 0 ? amount : 100;
}

// "100 g", "250 ml", "1 unidade" — a referência a que os valores do alimento se aplicam.
function baseLabel(food) {
  const amount = baseAmountOf(food);
  if (baseUnitOf(food) === 'un') return amount === 1 ? t('1 unidade') : t('{0} unidades', formatNumber(amount));
  return `${formatNumber(amount)} ${baseUnitOf(food)}`;
}

// Nome do alimento no idioma escolhido. Só a base compartilhada tem tradução
// (name_en / name_es); o que o próprio usuário cadastrou aparece como ele escreveu.
function foodName(food) {
  if (!food) return '';
  if (currentLanguage === 'en' && food.name_en) return food.name_en;
  if (currentLanguage === 'es' && food.name_es) return food.name_es;
  return food.name;
}

// A busca encontra o alimento por qualquer um dos nomes: quem usa inglês acha "Alface"
// digitando "lettuce" e também digitando "alface".
function foodMatches(food, termoNormalizado) {
  return [food.name, food.name_en, food.name_es].some((nome) => nome && normalizeText(nome).includes(termoNormalizado));
}

// Listas em ordem alfabética do nome que o usuário vê, não do nome em português.
function sortFoodsByName(lista) {
  return [...lista].sort((a, b) => foodName(a).localeCompare(foodName(b), appLocale()));
}

function formatQuantity(quantity, food) {
  return `${formatNumber(quantity)} ${baseUnitOf(food)}`;
}

function appendMacroChips(target, values) {
  [[t('P'), values.protein], [t('C'), values.carbohydrates], [t('G'), values.fat]].forEach(([label, value]) => {
    const chip = document.createElement('span');
    const key = document.createElement('b');
    key.textContent = label;
    chip.append(key, document.createTextNode(` ${formatNumber(value)} g`));
    target.append(chip);
  });
}

function openDialog(id) {
  document.querySelector(`#${id}`).showModal();
}

function closeDialog(id) {
  document.querySelector(`#${id}`).close();
}

/* ---------------------------------------------------------
   Alimentos
   --------------------------------------------------------- */

function renderFoods(foods) {
  const list = document.querySelector('#food-list');
  list.replaceChildren();
  if (!foods.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = t('Nenhum alimento encontrado.');
    list.append(emptyState);
    return;
  }
  foods.forEach((food) => {
    const card = document.createElement('article');
    card.className = `food-item${food.user_id ? ' is-own' : ''}`;
    card.dataset.foodId = String(food.id);

    const thumb = document.createElement('span');
    thumb.className = 'food-thumb';
    thumb.append(createIcon(food.user_id ? 'i-sparkle' : 'i-apple'));

    const body = document.createElement('span');
    body.className = 'food-body';
    const title = document.createElement('span');
    title.className = 'food-title';
    const name = document.createElement('strong');
    name.textContent = foodName(food);
    title.append(name);
    if (food.user_id) {
      const badge = document.createElement('span');
      badge.className = 'own-badge';
      badge.textContent = t('Meu');
      title.append(badge);
    }
    const nutrition = document.createElement('small');
    nutrition.textContent = t('{0} kcal · {1}{2}', formatNumber(food.calories), baseLabel(food), food.portion_label ? ` · ${food.portion_label}` : '');
    const macros = document.createElement('span');
    macros.className = 'food-macros';
    appendMacroChips(macros, food);
    body.append(title, nutrition, macros);

    card.append(thumb, body);

    if (food.user_id) {
      const actions = document.createElement('span');
      actions.className = 'item-actions';
      actions.append(
        createIconButton('i-edit', 'ghost-button', t('Editar {0}', foodName(food)), () => openFoodDialog(food)),
        createIconButton('i-trash', 'ghost-button danger', t('Excluir {0}', foodName(food)), () => removeFood(food)),
      );
      card.append(actions);
    }

    list.append(card);
  });
}

function openFoodDialog(food = null) {
  editingFoodId = food ? food.id : null;
  document.querySelector('#food-dialog-title').textContent = food ? t('Editar alimento') : t('Novo alimento');
  document.querySelector('#food-submit').textContent = food ? t('Salvar alterações') : t('Salvar alimento');
  document.querySelector('#food-name').value = food ? food.name : '';
  document.querySelector('#food-unit').value = food ? baseUnitOf(food) : 'g';
  document.querySelector('#food-serving').value = food ? baseAmountOf(food) : 100;
  document.querySelector('#food-calories').value = food ? food.calories : '';
  document.querySelector('#food-protein').value = food ? food.protein : '';
  document.querySelector('#food-carbs').value = food ? food.carbohydrates : '';
  document.querySelector('#food-fat').value = food ? food.fat : '';
  document.querySelector('#food-portion').value = food && food.portion_amount ? food.portion_amount : '';
  document.querySelector('#food-feedback').textContent = '';
  updateFoodBaseLabels();
  openDialog('food-dialog');
}

// Mantém o sufixo do campo e a legenda dos macros de acordo com unidade e quantidade base.
function updateFoodBaseLabels() {
  const unit = document.querySelector('#food-unit').value;
  const amount = Number(document.querySelector('#food-serving').value);
  const preview = { base_unit: unit, serving_size: Number.isFinite(amount) && amount > 0 ? amount : 100 };
  document.querySelector('#food-serving-unit').textContent = baseUnitOf(preview);
  document.querySelector('#food-base-label').textContent = baseLabel(preview);
  // Alimento já contado por unidade não precisa declarar o peso de uma unidade.
  document.querySelector('#food-portion-unit').textContent = baseUnitOf(preview);
  document.querySelector('#food-portion-field').hidden = baseUnitOf(preview) === 'un';
}

// Trocar o tipo de unidade ajusta a base padrão: 1 unidade faz sentido, 100 unidades não.
function handleFoodUnitChange() {
  const unit = document.querySelector('#food-unit').value;
  const serving = document.querySelector('#food-serving');
  const current = Number(serving.value);
  if (unit === 'un' && current === 100) serving.value = 1;
  else if (unit !== 'un' && current === 1) serving.value = 100;
  updateFoodBaseLabels();
}

async function handleFoodSubmit(event) {
  event.preventDefault();
  const feedback = document.querySelector('#food-feedback');
  const button = document.querySelector('#food-submit');
  const name = document.querySelector('#food-name').value.trim();
  const servingSize = Number(document.querySelector('#food-serving').value);
  const portionInput = document.querySelector('#food-portion').value.trim();
  const portionAmount = portionInput === '' ? null : Number(portionInput);
  const values = {
    calories: Number(document.querySelector('#food-calories').value),
    protein: Number(document.querySelector('#food-protein').value || 0),
    carbohydrates: Number(document.querySelector('#food-carbs').value || 0),
    fat: Number(document.querySelector('#food-fat').value || 0),
  };
  if (!name) {
    feedback.textContent = t('Dê um nome ao alimento.');
    return;
  }
  if (!Number.isFinite(servingSize) || servingSize <= 0) {
    feedback.textContent = t('Informe uma quantidade base maior que zero.');
    return;
  }
  if (portionAmount !== null && (!Number.isFinite(portionAmount) || portionAmount <= 0)) {
    feedback.textContent = t('O peso de 1 unidade precisa ser maior que zero.');
    return;
  }
  if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0)) {
    feedback.textContent = t('Use apenas números iguais ou maiores que zero.');
    return;
  }
  button.disabled = true;
  feedback.textContent = '';
  try {
    await saveFood({
      name,
      base_unit: document.querySelector('#food-unit').value,
      serving_size: servingSize,
      portion_amount: portionAmount,
      ...values,
    }, editingFoodId);
    closeDialog('food-dialog');
    showToast(editingFoodId ? t('Alimento atualizado.') : t('Alimento criado.'));
    await loadFoodCatalog();
    filterFoodList(name);
  } catch (error) {
    feedback.textContent = error && error.code === '23505'
      ? t('Você já tem um alimento com esse nome.')
      : t('Não foi possível salvar o alimento. Tente novamente.');
  } finally {
    button.disabled = false;
  }
}

async function removeFood(food) {
  if (!window.confirm(t('Excluir “{0}”? Ele também sai das receitas em que aparece.', foodName(food)))) return;
  try {
    await deleteFood(food.id);
    showToast(t('Alimento excluído.'));
    await loadFoodCatalog();
    await loadRecipes();
  } catch (error) {
    showToast(error && error.code === '23503'
      ? t('Esse alimento está em uma refeição registrada. Remova a refeição antes.')
      : t('Não foi possível excluir o alimento.'), 'error');
  }
}

function filterFoodList(term = '') {
  const search = document.querySelector('#food-search');
  search.value = term;
  const needle = normalizeText(term.trim());
  const ordenados = sortFoodsByName(needle ? foodCatalog.filter((food) => foodMatches(food, needle)) : foodCatalog);
  renderFoods(needle ? ordenados : ordenados.slice(0, FOOD_PAGE_SIZE));
}

async function loadFoodCatalog() {
  foodCatalog = await listAllFoods();
  fillRecipeFoodSelect();
  renderFoods(foodCatalog.slice(0, FOOD_PAGE_SIZE));
}

/* ---------------------------------------------------------
   Receitas
   --------------------------------------------------------- */

function renderRecipes(recipes) {
  const list = document.querySelector('#recipe-list');
  list.replaceChildren();
  if (!recipes.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = t('Você ainda não tem receitas. Crie uma para registrar suas refeições de sempre em um toque.');
    list.append(emptyState);
    return;
  }
  recipes.forEach((recipe) => {
    const items = recipe.recipe_items || [];
    const totals = calculateRecipeTotals(items);
    const card = document.createElement('article');
    card.className = 'recipe-card';

    const header = document.createElement('div');
    header.className = 'recipe-header';
    const heading = document.createElement('h3');
    heading.textContent = recipe.name;
    const actions = document.createElement('span');
    actions.className = 'item-actions';
    actions.append(
      createIconButton('i-edit', 'ghost-button', t('Editar {0}', recipe.name), () => openRecipeDialog(recipe)),
      createIconButton('i-trash', 'ghost-button danger', t('Excluir {0}', recipe.name), () => removeRecipe(recipe)),
    );
    header.append(heading, actions);

    const ingredients = document.createElement('p');
    ingredients.className = 'recipe-ingredients';
    ingredients.textContent = items.length
      ? items.map((item) => `${item.foods ? foodName(item.foods) : t('Alimento removido')} ${formatQuantity(item.quantity, item.foods)}`).join(' · ')
      : t('Sem ingredientes.');

    const summary = document.createElement('div');
    summary.className = 'recipe-total';
    const calories = document.createElement('strong');
    calories.textContent = `${formatNumber(totals.calories)} kcal`;
    const macros = document.createElement('span');
    macros.className = 'food-macros';
    appendMacroChips(macros, totals);
    summary.append(calories, macros);

    card.append(header, ingredients, summary);
    list.append(card);
  });
}

// Busca sem acento e sem caixa: "acucar" encontra "Açúcar", "PAO" encontra "Pão francês".
function normalizeText(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Helpers compartilhados pelos dois seletores de alimento (receita e registro de consumo).
function matchingFoods(term) {
  const needle = normalizeText(String(term || '').trim());
  return sortFoodsByName(needle ? foodCatalog.filter((food) => foodMatches(food, needle)) : foodCatalog);
}

function populateFoodSelect(select, matches) {
  const previous = select.value;
  select.replaceChildren();
  matches.forEach((food) => {
    const option = document.createElement('option');
    option.value = String(food.id);
    option.textContent = food.user_id ? t('{0} (meu)', foodName(food)) : foodName(food);
    select.append(option);
  });
  if (previous && matches.some((food) => String(food.id) === previous)) select.value = previous;
}

function describeMatches(counter, matches, term) {
  if (!matches.length) counter.textContent = t('(nenhum resultado)');
  else if (!term) counter.textContent = `(${matches.length})`;
  else counter.textContent = matches.length === 1 ? t('(1 resultado)') : t('({0} resultados)', matches.length);
}

function populateUnitSelect(select, food) {
  const previous = select.value;
  const options = recipeUnitOptions(food);
  select.replaceChildren();
  options.forEach((option) => {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  });
  if (options.some((option) => option.value === previous)) select.value = previous;
  return options;
}

function defaultQuantityFor(food, option) {
  return !option || option.factor !== 1 || baseUnitOf(food) === 'un' ? '1' : '100';
}

function fillRecipeFoodSelect() {
  const select = document.querySelector('#recipe-food');
  const previous = select.value;
  const term = normalizeText(document.querySelector('#recipe-food-search').value.trim());
  const matches = matchingFoods(term);

  select.replaceChildren();
  matches.forEach((food) => {
    const option = document.createElement('option');
    option.value = String(food.id);
    option.textContent = food.user_id ? t('{0} (meu)', foodName(food)) : foodName(food);
    select.append(option);
  });
  // Mantém o alimento escolhido enquanto ele continuar entre os resultados.
  if (previous && matches.some((food) => String(food.id) === previous)) select.value = previous;

  const counter = document.querySelector('#recipe-food-count');
  if (!matches.length) counter.textContent = t('(nenhum resultado)');
  else if (!term) counter.textContent = `(${matches.length})`;
  else counter.textContent = matches.length === 1 ? t('(1 resultado)') : t('({0} resultados)', matches.length);

  updateRecipeUnit(true);
}

function selectedRecipeFood() {
  return foodCatalog.find((item) => String(item.id) === document.querySelector('#recipe-food').value);
}

// Medidas oferecidas para um alimento: a unidade base dele e, quando existe uma conversão
// conhecida (portion_amount), a porção prática. Sem conversão registrada a opção não aparece,
// porque converter g em ml ou em unidade sem densidade ou peso seria inventar número.
function recipeUnitOptions(food) {
  if (!food) return [];
  const unit = baseUnitOf(food);
  const options = [{ value: 'base', label: unit === 'un' ? t('unidade') : unit, factor: 1 }];
  const portion = Number(food.portion_amount);
  if (unit !== 'un' && portion > 0) {
    options.push({ value: 'portion', label: food.portion_label || t('1 unidade ({0} {1})', formatNumber(portion), unit), factor: portion });
  }
  return options;
}

function selectedRecipeUnit() {
  const value = document.querySelector('#recipe-unit').value;
  return recipeUnitOptions(selectedRecipeFood()).find((option) => option.value === value);
}

// A quantidade só recebe o padrão da medida enquanto o usuário não digitou nada:
// trocar de alimento depois de escolher a quantidade não pode apagar o que foi digitado.
function applyRecipeQuantityDefault() {
  if (recipeQuantityTouched) return;
  const option = selectedRecipeUnit();
  const porUnidade = !option || option.factor !== 1 || baseUnitOf(selectedRecipeFood()) === 'un';
  document.querySelector('#recipe-quantity').value = porUnidade ? '1' : '100';
}

function updateRecipeUnit(resetQuantity = false) {
  const select = document.querySelector('#recipe-unit');
  const previous = select.value;
  const options = recipeUnitOptions(selectedRecipeFood());
  select.replaceChildren();
  options.forEach((option) => {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  });
  if (options.some((option) => option.value === previous)) select.value = previous;
  if (resetQuantity) applyRecipeQuantityDefault();
}

function openRecipeDialog(recipe = null) {
  recipeDraft = {
    id: recipe ? recipe.id : null,
    items: recipe
      ? (recipe.recipe_items || []).filter((item) => item.foods).map((item) => ({ food_id: item.food_id, quantity: Number(item.quantity), foods: item.foods }))
      : [],
  };
  document.querySelector('#recipe-dialog-title').textContent = recipe ? t('Editar receita') : t('Nova receita');
  document.querySelector('#recipe-submit').textContent = recipe ? t('Salvar alterações') : t('Salvar receita');
  document.querySelector('#recipe-name').value = recipe ? recipe.name : '';
  document.querySelector('#recipe-feedback').textContent = '';
  document.querySelector('#recipe-food-search').value = '';
  recipeQuantityTouched = false;
  fillRecipeFoodSelect();
  renderRecipeDraft();
  openDialog('recipe-dialog');
}

function renderRecipeDraft() {
  const list = document.querySelector('#recipe-items');
  list.replaceChildren();
  recipeDraft.items.forEach((item, index) => {
    const row = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'ingredient-info';
    const name = document.createElement('strong');
    name.textContent = foodName(item.foods);
    const detail = document.createElement('small');
    const nutrition = calculateNutrition(item.foods, item.quantity);
    detail.textContent = t('{0} · {1} kcal', formatQuantity(item.quantity, item.foods), formatNumber(nutrition.calories));
    info.append(name, detail);
    row.append(info, createIconButton('i-trash', 'ghost-button danger', t('Remover {0}', foodName(item.foods)), () => {
      recipeDraft.items.splice(index, 1);
      renderRecipeDraft();
    }));
    list.append(row);
  });

  const summary = document.querySelector('#recipe-summary');
  summary.replaceChildren();
  if (!recipeDraft.items.length) {
    summary.textContent = t('Inclua pelo menos um alimento.');
    return;
  }
  const totals = calculateRecipeTotals(recipeDraft.items);
  const calories = document.createElement('strong');
  calories.textContent = t('{0} kcal no total', formatNumber(totals.calories));
  const macros = document.createElement('span');
  macros.className = 'food-macros';
  appendMacroChips(macros, totals);
  summary.append(calories, macros);
}

function addRecipeItem() {
  const feedback = document.querySelector('#recipe-feedback');
  const food = selectedRecipeFood();
  const option = selectedRecipeUnit();
  const typed = Number(document.querySelector('#recipe-quantity').value);
  if (!food || !option) {
    feedback.textContent = t('Escolha um alimento.');
    return;
  }
  if (!Number.isFinite(typed) || typed <= 0) {
    feedback.textContent = t('Informe uma quantidade maior que zero.');
    return;
  }
  // Guardamos sempre na unidade base do alimento; a medida escolhida é só a forma de digitar.
  const quantity = Number((typed * option.factor).toFixed(2));
  if (quantity > 100000) {
    feedback.textContent = t('Quantidade muito alta para este alimento.');
    return;
  }
  feedback.textContent = '';
  const existing = recipeDraft.items.find((item) => String(item.food_id) === String(food.id));
  if (existing) existing.quantity += quantity;
  else recipeDraft.items.push({ food_id: food.id, quantity, foods: food });
  recipeQuantityTouched = false;
  updateRecipeUnit(true);
  renderRecipeDraft();
}

async function handleRecipeSubmit(event) {
  event.preventDefault();
  const feedback = document.querySelector('#recipe-feedback');
  const button = document.querySelector('#recipe-submit');
  const name = document.querySelector('#recipe-name').value.trim();
  if (!name) {
    feedback.textContent = t('Dê um nome à receita.');
    return;
  }
  if (!recipeDraft.items.length) {
    feedback.textContent = t('Inclua pelo menos um alimento.');
    return;
  }
  button.disabled = true;
  feedback.textContent = '';
  try {
    await saveRecipe({
      id: recipeDraft.id,
      name,
      items: recipeDraft.items.map((item) => ({ food_id: item.food_id, quantity: item.quantity })),
    });
    closeDialog('recipe-dialog');
    showToast(recipeDraft.id ? t('Receita atualizada.') : t('Receita criada.'));
    await loadRecipes();
  } catch (error) {
    feedback.textContent = error && error.code === '23505'
      ? t('Você já tem uma receita com esse nome.')
      : t('Não foi possível salvar a receita. Tente novamente.');
  } finally {
    button.disabled = false;
  }
}

async function removeRecipe(recipe) {
  if (!window.confirm(t('Excluir a receita “{0}”?', recipe.name))) return;
  try {
    await deleteRecipe(recipe.id);
    showToast(t('Receita excluída.'));
    await loadRecipes();
  } catch (error) {
    showToast(t('Não foi possível excluir a receita.'), 'error');
  }
}

async function loadRecipes() {
  recipeList = await getRecipes();
  renderRecipes(recipeList);
}

/* ---------------------------------------------------------
   Metas nutricionais
   --------------------------------------------------------- */

function currentGoals() {
  if (!isProfileComplete(nutritionProfile)) return DEFAULT_GOALS;
  return {
    calories: Number(nutritionProfile.target_calories),
    protein: Number(nutritionProfile.protein_g),
    carbohydrates: Number(nutritionProfile.carbs_g),
    fat: Number(nutritionProfile.fat_g),
  };
}

async function loadNutritionProfile() {
  nutritionProfile = await getNutritionProfile();
  syncLanguageWithProfile();
  applyProfileToInterface();
  return nutritionProfile;
}

/* Idioma -------------------------------------------------------------- */

function updateLanguageControls() {
  document.querySelector('#lang-code').textContent = LANGUAGES[currentLanguage].short;
  document.querySelectorAll('[data-language]').forEach((botao) => {
    const ativo = botao.dataset.language === currentLanguage;
    botao.classList.toggle('selected', ativo);
    if (botao.hasAttribute('aria-checked')) botao.setAttribute('aria-checked', String(ativo));
    if (botao.hasAttribute('aria-pressed')) botao.setAttribute('aria-pressed', String(ativo));
  });
}

function toggleLanguageMenu(abrir) {
  const menu = document.querySelector('#lang-menu');
  const botao = document.querySelector('[data-action="language"]');
  const aberto = abrir ?? menu.hidden;
  menu.hidden = !aberto;
  botao.setAttribute('aria-expanded', String(aberto));
  if (aberto) {
    const atual = menu.querySelector(`[data-language="${currentLanguage}"]`);
    if (atual) atual.focus();
  }
}

// A conta tem prioridade sobre o aparelho: quem escolheu inglês no celular vê inglês
// também no computador. Conta sem preferência salva recebe a escolha atual.
function syncLanguageWithProfile() {
  if (!nutritionProfile) return;
  const daConta = nutritionProfile.language;
  if (LANGUAGES[daConta]) {
    setLanguage(daConta);
  } else {
    saveLanguagePreference(currentLanguage)
      .then(() => { nutritionProfile.language = currentLanguage; })
      .catch(() => {});
  }
}

function chooseLanguage(idioma) {
  toggleLanguageMenu(false);
  if (!setLanguage(idioma)) return;
  showToast(t('Idioma alterado.'));
  const logado = !document.querySelector('#app-shell').hidden;
  if (!logado) return;
  saveLanguagePreference(idioma)
    .then(() => { if (nutritionProfile) nutritionProfile.language = idioma; })
    .catch((error) => showToast(`${t('Idioma alterado.')} ${describeDatabaseError(error)}`, 'error'));
}

// Tudo que é gerado pelo JS é redesenhado no idioma novo. Os textos fixos do HTML já
// foram trocados por applyStaticTexts(); os diálogos não precisam, porque enquanto um
// está aberto o fundo modal impede de alcançar o seletor de idioma.
function rerenderForLanguage() {
  updateLanguageControls();
  // A tela de acesso é redesenhada mesmo escondida, sem mudar a visibilidade dela.
  const gate = document.querySelector('#auth-gate');
  const gateEscondido = gate.hidden;
  openAuthModal(authMode);
  gate.hidden = gateEscondido;
  if (document.querySelector('#app-shell').hidden) return;
  renderSelectedDate();
  applyProfileToInterface();
  // Durante a carga inicial (idioma vindo da conta), o próprio carregamento desenha o
  // resto; redesenhar em paralelo criaria as refeições padrão duas vezes numa conta nova.
  if (!appReady) return;
  filterFoodList(document.querySelector('#food-search').value);
  renderRecipes(recipeList);
  renderWeight();
  refreshDashboard().catch((error) => showToast(`${t('Não foi possível carregar suas refeições.')} ${describeDatabaseError(error)}`, 'error'));
}

// "Pronta" para quem informou sexo feminino no questionário; em outro dia que não hoje,
// a frase com "hoje" deixaria de fazer sentido.
function renderGreeting() {
  const nota = document.querySelector('#greeting-note');
  if (!nota) return;
  if (selectedDate !== todayKey()) {
    nota.textContent = t('Revise ou complete o que você comeu neste dia.');
    return;
  }
  const pronto = nutritionProfile && nutritionProfile.sex === 'female' ? t('Pronta') : t('Pronto');
  nota.textContent = t('{0} para cuidar da sua alimentação hoje?', pronto);
}

// O nome salvo em profiles tem prioridade sobre o dos metadados do Auth.
function applyProfileToInterface() {
  if (nutritionProfile && nutritionProfile.name) {
    const initials = getInitials(nutritionProfile.name);
    document.querySelector('#user-name').textContent = nutritionProfile.name;
    document.querySelector('#profile-name').textContent = nutritionProfile.name;
    document.querySelector('#profile-name-input').value = nutritionProfile.name;
    document.querySelector('#profile-avatar').textContent = initials;
    document.querySelector('[data-action="profile"]').textContent = initials;
  }
  renderProfileGoals();
  renderGreeting();
}

function appendGoalMacros(target, protein, carbs, fat) {
  [[t('Proteína'), protein, 'protein'], [t('Carboidratos'), carbs, 'carbs'], [t('Gorduras'), fat, 'fats']].forEach(([label, value, kind]) => {
    const tile = document.createElement('div');
    tile.className = `goal-macro ${kind}`;
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = `${formatNumber(value)} g`;
    tile.append(name, amount);
    target.append(tile);
  });
}

// Traduz o erro do banco em instrução. O código bruto vai junto quando não é um caso
// conhecido: um "tente novamente" genérico esconde justamente o que precisa ser corrigido.
function describeDatabaseError(error) {
  if (!error) return t('Erro desconhecido.');
  const code = error.code || '';
  if (code === 'PGRST204' || code === '42703') {
    return t('O banco ainda não tem as colunas do questionário. Rode o supabase.sql atualizado no SQL Editor do Supabase.');
  }
  if (code === '42501') {
    return t('Sem permissão para gravar o perfil. Rode os grants do supabase.sql no SQL Editor.');
  }
  if (code === '23514') {
    return t('Algum valor ficou fora dos limites aceitos pelo banco. Revise os dados informados.');
  }
  if (code === '23505') {
    return t('Já existe um registro com esses dados.');
  }
  if (code === '42P01') {
    return t('A tabela não existe neste projeto do Supabase. Rode o supabase.sql no SQL Editor.');
  }
  const message = error.message || error.details || t('sem detalhes');
  return code ? t('{0} (código {1})', message, code) : message;
}

function renderGoalWarnings(selector, warnings) {
  const container = document.querySelector(selector);
  container.replaceChildren();
  warnings.forEach((text) => {
    const box = document.createElement('p');
    box.className = 'warning-box';
    box.setAttribute('role', 'alert');
    box.append(createIcon('i-alert'), document.createTextNode(text));
    container.append(box);
  });
}

function renderProfileGoals() {
  const target = document.querySelector('#profile-target-calories');
  const tdee = document.querySelector('#profile-tdee');
  const macros = document.querySelector('#profile-goal-macros');
  const details = document.querySelector('#profile-goal-details');
  macros.replaceChildren();
  if (!isProfileComplete(nutritionProfile)) {
    target.textContent = '—';
    tdee.textContent = t('Gasto calórico estimado: —');
    details.textContent = t('Responda ao questionário para calcular suas metas.');
    renderGoalWarnings('#profile-goal-warnings', []);
    return;
  }
  target.textContent = `${formatNumber(nutritionProfile.target_calories)} kcal`;
  tdee.textContent = t('Gasto calórico estimado: {0} kcal', formatNumber(nutritionProfile.tdee));
  appendGoalMacros(macros, nutritionProfile.protein_g, nutritionProfile.carbs_g, nutritionProfile.fat_g);
  details.textContent = t('{0} · {1} · {2} kg, {3} cm, {4} anos', t(GOALS[nutritionProfile.goal].label), t(ACTIVITY_LEVELS[nutritionProfile.activity_level].label), formatNumber(nutritionProfile.weight), formatNumber(nutritionProfile.height), nutritionProfile.age);
  // Os sinalizadores não são gravados: recalcula a partir das respostas para saber se
  // algum limite de segurança entrou em ação neste perfil.
  renderGoalWarnings('#profile-goal-warnings', describeGoalWarnings(calculateNutritionGoals(profileAnswers(nutritionProfile))));
}

/* Questionário em etapas ------------------------------------------------ */

function openGoalsDialog(mandatory = false) {
  goalsMandatory = mandatory;
  goalDraft = {
    weight: nutritionProfile && nutritionProfile.weight ? Number(nutritionProfile.weight) : null,
    height: nutritionProfile && nutritionProfile.height ? Number(nutritionProfile.height) : null,
    age: nutritionProfile && nutritionProfile.age ? Number(nutritionProfile.age) : null,
    sex: nutritionProfile ? nutritionProfile.sex : null,
    activity_level: nutritionProfile ? nutritionProfile.activity_level : null,
    goal: nutritionProfile ? nutritionProfile.goal : null,
  };
  document.querySelector('#goal-weight').value = goalDraft.weight || '';
  document.querySelector('#goal-height').value = goalDraft.height || '';
  document.querySelector('#goal-age').value = goalDraft.age || '';
  document.querySelector('#goals-close').hidden = mandatory;
  document.querySelector('#goals-dialog-title').textContent = isProfileComplete(nutritionProfile)
    ? t('Atualizar suas metas')
    : t('Vamos calcular suas metas');
  renderGoalOptions();
  showGoalStep(0);
  openDialog('goals-dialog');
}

function renderGoalOptions() {
  buildOptionGrid('#goal-sex-options', Object.entries(SEX_OPTIONS).map(([value, label]) => ({ value, label: t(label) })), 'sex');
  buildOptionGrid('#goal-activity-options', Object.entries(ACTIVITY_LEVELS).map(([value, config]) => ({ value, label: t(config.label), hint: t(config.hint) })), 'activity_level');
  buildOptionGrid('#goal-objective-options', Object.entries(GOALS).map(([value, config]) => ({ value, label: t(config.label), hint: t(config.hint) })), 'goal');
}

// As opções saem das constantes de goals.js: rótulos e valores não se repetem no HTML.
function buildOptionGrid(selector, options, field) {
  const container = document.querySelector(selector);
  container.replaceChildren();
  options.forEach((option) => {
    const card = document.createElement('button');
    card.className = `option-card${goalDraft[field] === option.value ? ' selected' : ''}`;
    card.type = 'button';
    card.dataset.value = option.value;
    card.setAttribute('aria-pressed', String(goalDraft[field] === option.value));
    const label = document.createElement('strong');
    label.textContent = option.label;
    card.append(label);
    if (option.hint) {
      const hint = document.createElement('span');
      hint.textContent = option.hint;
      card.append(hint);
    }
    card.addEventListener('click', () => {
      goalDraft[field] = option.value;
      container.querySelectorAll('.option-card').forEach((item) => {
        const active = item.dataset.value === option.value;
        item.classList.toggle('selected', active);
        item.setAttribute('aria-pressed', String(active));
      });
      document.querySelector('#goals-feedback').textContent = '';
    });
    container.append(card);
  });
}

function showGoalStep(step) {
  goalStep = step;
  const isSummary = step === GOAL_STEPS;
  document.querySelectorAll('.goal-step').forEach((section) => { section.hidden = Number(section.dataset.step) !== step; });
  const label = document.querySelector('#goals-step-label');
  label.hidden = isSummary;
  label.textContent = t('Etapa {0} de {1}', step + 1, GOAL_STEPS);
  document.querySelector('#goals-progress').style.width = `${((isSummary ? GOAL_STEPS : step + 1) / GOAL_STEPS) * 100}%`;
  document.querySelector('#goals-back').hidden = step === 0 || isSummary;
  document.querySelector('#goals-next').textContent = isSummary ? t('Começar') : step === GOAL_STEPS - 1 ? t('Calcular metas') : t('Continuar');
  document.querySelector('#goals-feedback').textContent = '';
  const input = document.querySelector(`.goal-step[data-step="${step}"] input`);
  if (input) input.focus();
}

// Guarda o que foi digitado antes de sair da etapa, para o botão Voltar não perder nada.
function captureGoalStep(step) {
  if (step === 0) goalDraft.weight = Number(document.querySelector('#goal-weight').value);
  if (step === 1) goalDraft.height = Number(document.querySelector('#goal-height').value);
  if (step === 2) goalDraft.age = Number(document.querySelector('#goal-age').value);
}

function validateGoalStep(step) {
  if (step === 0) return validateProfileNumber(goalDraft.weight, PROFILE_LIMITS.weight) ? null : t('Informe um peso entre {0} e {1} kg.', PROFILE_LIMITS.weight.min, PROFILE_LIMITS.weight.max);
  if (step === 1) return validateProfileNumber(goalDraft.height, PROFILE_LIMITS.height) ? null : t('Informe uma altura entre {0} e {1} cm.', PROFILE_LIMITS.height.min, PROFILE_LIMITS.height.max);
  if (step === 2) return validateProfileNumber(goalDraft.age, PROFILE_LIMITS.age) && Number.isInteger(goalDraft.age) ? null : t('Informe uma idade inteira entre {0} e {1} anos.', PROFILE_LIMITS.age.min, PROFILE_LIMITS.age.max);
  if (step === 3) return SEX_OPTIONS[goalDraft.sex] ? null : t('Escolha uma opção para continuar.');
  if (step === 4) return ACTIVITY_LEVELS[goalDraft.activity_level] ? null : t('Escolha seu nível de atividade física.');
  if (step === 5) return GOALS[goalDraft.goal] ? null : t('Escolha seu objetivo.');
  return null;
}

function renderGoalsSummary(goals) {
  document.querySelector('#summary-tdee').textContent = `${formatNumber(goals.tdee)} kcal`;
  document.querySelector('#summary-target').textContent = `${formatNumber(goals.target_calories)} kcal`;
  document.querySelector('#summary-goal-label').textContent = t('Meta para {0}', t((GOALS[goalDraft.goal] || GOALS.maintenance).label).toLowerCase());
  const macros = document.querySelector('#summary-macros');
  macros.replaceChildren();
  appendGoalMacros(macros, goals.protein_g, goals.carbs_g, goals.fat_g);
  renderGoalWarnings('#summary-warnings', describeGoalWarnings(goals));
}

async function handleGoalsSubmit(event) {
  event.preventDefault();
  const feedback = document.querySelector('#goals-feedback');
  if (goalStep === GOAL_STEPS) {
    closeDialog('goals-dialog');
    showView('inicio');
    return;
  }
  captureGoalStep(goalStep);
  const stepError = validateGoalStep(goalStep);
  if (stepError) {
    feedback.textContent = stepError;
    return;
  }
  if (goalStep < GOAL_STEPS - 1) {
    showGoalStep(goalStep + 1);
    return;
  }
  // Revalida o conjunto inteiro antes de gravar, nao so a ultima etapa.
  const invalid = validateNutritionAnswers(goalDraft);
  if (invalid) {
    feedback.textContent = invalid;
    return;
  }
  const button = document.querySelector('#goals-next');
  button.disabled = true;
  try {
    const goals = calculateNutritionGoals(goalDraft);
    nutritionProfile = await saveNutritionProfile(goalDraft, goals, document.querySelector('#profile-name-input').value.trim());
    // O peso informado no questionário também entra no histórico, com a data de hoje.
    await saveWeightLog(todayKey(), goalDraft.weight)
      .catch((error) => showToast(t('Metas salvas, mas o peso não entrou no histórico. {0}', describeDatabaseError(error)), 'error'));
    renderGoalsSummary(goals);
    applyProfileToInterface();
    await refreshDashboard();
    await loadWeight().catch(() => {});
    showGoalStep(GOAL_STEPS);
  } catch (error) {
    feedback.textContent = t('Não foi possível salvar suas metas. {0}', describeDatabaseError(error));
  } finally {
    button.disabled = false;
  }
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const name = document.querySelector('#profile-name-input').value.trim();
  if (!name) {
    showToast(t('Informe seu nome.'), 'error');
    return;
  }
  try {
    nutritionProfile = await saveProfileName(name);
    applyProfileToInterface();
    showToast(t('Perfil atualizado.'));
  } catch (error) {
    showToast(t('Não foi possível salvar o perfil. {0}', describeDatabaseError(error)), 'error');
  }
}

/* ---------------------------------------------------------
   Dia selecionado
   --------------------------------------------------------- */

// Nome do dia da semana no idioma atual ("Seg", "Mon", "Lun"...), com inicial maiúscula.
function weekdayName(data, formato) {
  const nome = new Intl.DateTimeFormat(appLocale(), { weekday: formato }).format(data).replace('.', '');
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function formatDayMonth(key) {
  return parseDateKey(key).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', ' ');
}

function formatLongDay(key) {
  const data = parseDateKey(key);
  return `${weekdayName(data, 'long')}, ${formatDayMonth(key)}`;
}

function renderSelectedDate() {
  const data = parseDateKey(selectedDate);
  const hoje = selectedDate === todayKey();
  document.querySelector('#day-number').textContent = data.getDate();
  document.querySelector('#month-label').textContent = data.toLocaleDateString(appLocale(), { month: 'short' }).replace('.', '').toUpperCase();
  const extenso = data.toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  document.querySelector('#today-label').textContent = hoje ? t('HOJE · {0}', extenso) : extenso;
  document.querySelector('#summary-kicker').textContent = hoje ? t('RESUMO DE HOJE') : t('RESUMO DE {0}', formatDayMonth(selectedDate).toUpperCase());
  document.querySelector('[data-action="go-today"]').hidden = hoje;
  renderGreeting();
  // Não existe consumo registrado no futuro: o avanço para no dia de hoje.
  document.querySelector('[data-action="next-day"]').disabled = selectedDate >= todayKey();
}

async function setSelectedDate(key) {
  selectedDate = key > todayKey() ? todayKey() : key;
  weekStart = weekStartKey(selectedDate);
  weekFocus = selectedDate;
  renderSelectedDate();
  await refreshDashboard();
}

function changeSelectedDate(key) {
  setSelectedDate(key).catch((error) => showToast(t('Não foi possível carregar o dia. {0}', describeDatabaseError(error)), 'error'));
}

/* Calendário ------------------------------------------------------------ */

function openCalendar() {
  const data = parseDateKey(selectedDate);
  calendarMonth = new Date(data.getFullYear(), data.getMonth(), 1);
  renderCalendar();
  openDialog('calendar-dialog');
}

function shiftCalendarMonth(delta) {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + delta, 1);
  renderCalendar();
}

function renderCalendar() {
  const ano = calendarMonth.getFullYear();
  const mes = calendarMonth.getMonth();
  const hoje = todayKey();
  const primeiro = toDateKey(new Date(ano, mes, 1));
  const ultimo = toDateKey(new Date(ano, mes + 1, 0));
  const titulo = calendarMonth.toLocaleDateString(appLocale(), { month: 'long', year: 'numeric' });
  document.querySelector('#calendar-month').textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  document.querySelector('[data-action="next-month"]').disabled = primeiro >= toDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const cabecalho = document.querySelector('#calendar-weekdays');
  cabecalho.replaceChildren();
  for (let i = 0; i < 7; i += 1) {
    const letra = document.createElement('span');
    letra.textContent = weekdayName(new Date(2024, 0, 1 + i), 'narrow'); // 1º/jan/2024 foi segunda-feira
    cabecalho.append(letra);
  }

  const grid = document.querySelector('#calendar-grid');
  grid.replaceChildren();
  // Semana começa na segunda: domingo ocupa a sétima coluna.
  const vazios = (new Date(ano, mes, 1).getDay() + 6) % 7;
  for (let i = 0; i < vazios; i += 1) grid.append(document.createElement('span'));

  const totalDias = new Date(ano, mes + 1, 0).getDate();
  for (let dia = 1; dia <= totalDias; dia += 1) {
    const key = toDateKey(new Date(ano, mes, dia));
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'calendar-day';
    botao.dataset.date = key;
    botao.textContent = String(dia);
    botao.setAttribute('aria-label', formatLongDay(key));
    if (key === hoje) {
      botao.classList.add('is-today');
      botao.setAttribute('aria-current', 'date');
    }
    if (key === selectedDate) {
      botao.classList.add('is-selected');
      botao.setAttribute('aria-pressed', 'true');
    }
    if (key > hoje) botao.disabled = true;
    botao.addEventListener('click', () => {
      closeDialog('calendar-dialog');
      changeSelectedDate(key);
    });
    grid.append(botao);
  }

  // Marca os dias com registro depois de desenhar a grade; uma troca rápida de mês
  // descarta a resposta atrasada do mês anterior.
  const pedido = ++calendarRequest;
  getLoggedDates(primeiro, ultimo)
    .then((datas) => {
      if (pedido !== calendarRequest) return;
      grid.querySelectorAll('.calendar-day').forEach((botao) => {
        const temDado = datas.has(botao.dataset.date);
        botao.classList.toggle('has-data', temDado);
        if (temDado) botao.setAttribute('aria-label', t('{0}, com registros', formatLongDay(botao.dataset.date)));
      });
    })
    .catch(() => {});
}

/* ---------------------------------------------------------
   Progresso: consumo da semana (segunda a domingo)
   --------------------------------------------------------- */

const MACRO_SERIES = [
  { key: 'protein', label: 'Proteína', kcal: 4, className: 'protein' },
  { key: 'carbohydrates', label: 'Carboidratos', kcal: 4, className: 'carbs' },
  { key: 'fat', label: 'Gorduras', kcal: 9, className: 'fats' },
];

async function loadWeek() {
  const fim = addDaysToKey(weekStart, 6);
  const meals = await getMealsInRange(weekStart, fim);
  weekDays = summarizeByDay(meals, weekStart);
  if (!weekFocus || weekFocus < weekStart || weekFocus > fim) {
    const hoje = todayKey();
    const comDado = [...weekDays].reverse().find((dia) => dia.calories > 0);
    weekFocus = hoje >= weekStart && hoje <= fim ? hoje : (comDado ? comDado.date : weekStart);
  }
  renderWeek();
}

function shiftWeek(delta) {
  weekStart = addDaysToKey(weekStart, delta * 7);
  weekFocus = null;
  loadWeek().catch((error) => showToast(t('Não foi possível carregar a semana. {0}', describeDatabaseError(error)), 'error'));
}

function renderWeek() {
  const fim = addDaysToKey(weekStart, 6);
  const hoje = todayKey();
  const semanaAtual = weekStart === weekStartKey(hoje);
  document.querySelector('#week-title').textContent = semanaAtual
    ? t('Esta semana · {0} – {1}', formatDayMonth(weekStart), formatDayMonth(fim))
    : `${formatDayMonth(weekStart)} – ${formatDayMonth(fim)}`;
  document.querySelector('[data-action="next-week"]').disabled = semanaAtual;

  renderWeekStats();
  renderWeekChart(hoje);
  renderWeekDetail();
  renderWeekTable();
}

function renderWeekStats() {
  const registrados = weekDays.filter((dia) => dia.calories > 0);
  const total = weekDays.reduce((soma, dia) => soma + dia.calories, 0);
  const media = registrados.length ? total / registrados.length : 0;
  const stats = document.querySelector('#week-stats');
  stats.replaceChildren();
  [
    [t('Total da semana'), `${formatNumber(total)} kcal`],
    [t('Média por dia registrado'), `${formatNumber(Math.round(media))} kcal`],
    [t('Dias registrados'), t('{0} de 7', registrados.length)],
  ].forEach(([rotulo, valor]) => {
    const item = document.createElement('div');
    const nome = document.createElement('span');
    nome.textContent = rotulo;
    const numero = document.createElement('strong');
    numero.textContent = valor;
    item.append(nome, numero);
    stats.append(item);
  });
}

// Uma barra por dia, com altura = calorias do dia. Os segmentos dividem essa altura na
// proporção das calorias vindas de cada macro — assim a barra mostra o total e a
// composição num eixo só, sem segundo eixo. Dia sem registro fica com barra zero.
function renderWeekChart(hoje) {
  const chart = document.querySelector('#week-chart');
  chart.replaceChildren();
  const meta = currentGoals().calories;
  const maior = Math.max(meta, ...weekDays.map((dia) => dia.calories));
  const teto = maior * 1.12;

  const plot = document.createElement('div');
  plot.className = 'week-plot';

  const linhaMeta = document.createElement('div');
  linhaMeta.className = 'week-goal-line';
  // Mesmo referencial das barras: a área acima da faixa de rótulos (--label-h).
  linhaMeta.style.bottom = `calc(var(--label-h) + (100% - var(--label-h)) * ${(meta / teto).toFixed(4)})`;
  const rotuloMeta = document.createElement('span');
  rotuloMeta.textContent = t('Meta {0} kcal', formatNumber(meta));
  linhaMeta.append(rotuloMeta);
  plot.append(linhaMeta);

  weekDays.forEach((dia) => {
    const data = parseDateKey(dia.date);
    const futuro = dia.date > hoje;
    const coluna = document.createElement('button');
    coluna.type = 'button';
    coluna.className = 'week-col';
    coluna.dataset.date = dia.date;
    if (dia.date === hoje) coluna.classList.add('is-today');
    if (dia.date === weekFocus) coluna.classList.add('is-focus');
    if (futuro) coluna.disabled = true;
    coluna.setAttribute('aria-label', futuro
      ? t('{0}: ainda não chegou', formatLongDay(dia.date))
      : t('{0}: {1} kcal, proteína {2} g, carboidratos {3} g, gorduras {4} g', formatLongDay(dia.date), formatNumber(dia.calories), formatNumber(dia.protein), formatNumber(dia.carbohydrates), formatNumber(dia.fat)));

    const area = document.createElement('span');
    area.className = 'week-bar-area';
    const pilha = document.createElement('span');
    pilha.className = 'week-stack';
    pilha.style.height = `${(dia.calories / teto) * 100}%`;

    const kcalMacros = MACRO_SERIES.map((serie) => dia[serie.key] * serie.kcal);
    const somaMacros = kcalMacros.reduce((a, b) => a + b, 0);
    MACRO_SERIES.forEach((serie, i) => {
      if (!kcalMacros[i] || !somaMacros) return;
      const segmento = document.createElement('i');
      segmento.className = `seg ${serie.className}`;
      segmento.style.flexGrow = String(kcalMacros[i] / somaMacros);
      pilha.append(segmento);
    });
    // Calorias sem macro associado (alimento cadastrado só com kcal): segmento neutro.
    if (dia.calories > 0 && !somaMacros) {
      const neutro = document.createElement('i');
      neutro.className = 'seg other';
      neutro.style.flexGrow = '1';
      pilha.append(neutro);
    }
    area.append(pilha);

    const rotulo = document.createElement('span');
    rotulo.className = 'week-label';
    const nomeDia = document.createElement('b');
    nomeDia.textContent = weekdayName(data, 'short');
    const numero = document.createElement('small');
    numero.textContent = String(data.getDate());
    rotulo.append(nomeDia, numero);

    coluna.append(area, rotulo);
    // Passar o mouse ou focar pelo teclado mostra o dia; no toque, o clique faz o mesmo.
    const focar = () => setWeekFocus(dia.date);
    coluna.addEventListener('pointerenter', focar);
    coluna.addEventListener('focus', focar);
    coluna.addEventListener('click', focar);
    plot.append(coluna);
  });

  chart.append(plot);
}

function setWeekFocus(key) {
  if (weekFocus === key) return;
  weekFocus = key;
  document.querySelectorAll('.week-col').forEach((coluna) => coluna.classList.toggle('is-focus', coluna.dataset.date === key));
  renderWeekDetail();
}

function renderWeekDetail() {
  const detalhe = document.querySelector('#week-detail');
  detalhe.replaceChildren();
  const dia = weekDays.find((item) => item.date === weekFocus);
  if (!dia) return;
  const meta = currentGoals().calories;

  const titulo = document.createElement('div');
  titulo.className = 'week-detail-head';
  const nome = document.createElement('strong');
  nome.textContent = formatLongDay(dia.date);
  const kcal = document.createElement('span');
  kcal.textContent = dia.calories
    ? t('{0} kcal · {1}% da meta', formatNumber(dia.calories), Math.round((dia.calories / meta) * 100))
    : t('Nenhum alimento registrado');
  titulo.append(nome, kcal);
  detalhe.append(titulo);

  if (dia.calories) {
    const macros = document.createElement('span');
    macros.className = 'food-macros';
    appendMacroChips(macros, dia);
    detalhe.append(macros);
  }

  const abrir = document.createElement('button');
  abrir.type = 'button';
  abrir.className = 'text-button';
  abrir.append(createIcon('i-calendar'), document.createTextNode(dia.calories ? t('Ver refeições deste dia') : t('Registrar neste dia')));
  abrir.addEventListener('click', () => {
    showView('inicio');
    changeSelectedDate(dia.date);
  });
  detalhe.append(abrir);
}

function renderWeekTable() {
  const corpo = document.querySelector('#week-table-body');
  corpo.replaceChildren();
  weekDays.forEach((dia) => {
    const linha = document.createElement('tr');
    [formatLongDay(dia.date), formatNumber(dia.calories), `${formatNumber(dia.protein)} g`, `${formatNumber(dia.carbohydrates)} g`, `${formatNumber(dia.fat)} g`]
      .forEach((valor, i) => {
        const celula = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) celula.scope = 'row';
        celula.textContent = valor;
        linha.append(celula);
      });
    corpo.append(linha);
  });
}

/* ---------------------------------------------------------
   Progresso: acompanhamento de peso
   --------------------------------------------------------- */

function formatKg(valor) {
  return `${new Intl.NumberFormat(appLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(valor)} kg`;
}

function formatVariation(delta) {
  if (Math.abs(delta) < 0.05) return t('estável');
  return `${delta > 0 ? '+' : '−'}${formatKg(Math.abs(delta))}`;
}

async function loadWeight() {
  weightLogs = await getWeightLogs();
  renderWeight();
}

// O gráfico e as estatísticas usam só a janela escolhida; o progresso até a meta
// usa a primeira pesagem de todo o histórico como ponto de partida.
function logsInRange() {
  const dias = WEIGHT_RANGES[weightRange];
  if (!dias) return weightLogs;
  const inicio = addDaysToKey(todayKey(), -(dias - 1));
  return weightLogs.filter((log) => log.date >= inicio);
}

function renderWeight() {
  const periodo = logsInRange();
  const alvo = nutritionProfile && nutritionProfile.target_weight ? Number(nutritionProfile.target_weight) : null;
  const dateInput = document.querySelector('#weight-date');
  dateInput.max = todayKey();
  if (!dateInput.value) dateInput.value = todayKey();
  document.querySelector('#weight-target-input').value = alvo || '';
  document.querySelectorAll('[data-weight-range]').forEach((botao) => {
    const ativo = botao.dataset.weightRange === weightRange;
    botao.classList.toggle('selected', ativo);
    botao.setAttribute('aria-selected', String(ativo));
  });

  renderWeightStats(periodo);
  renderWeightChart(periodo, alvo);
  renderWeightGoal(alvo);
  renderWeightTable();
}

function renderWeightStats(periodo) {
  const stats = document.querySelector('#weight-stats');
  stats.replaceChildren();
  const atual = weightLogs[weightLogs.length - 1];
  const variacao = periodo.length > 1 ? periodo[periodo.length - 1].weight_kg - periodo[0].weight_kg : null;
  [
    [t('Peso atual'), atual ? formatKg(atual.weight_kg) : '—'],
    [t('Variação no período'), variacao === null ? '—' : formatVariation(variacao)],
    [t('Pesagens no período'), String(periodo.length)],
  ].forEach(([rotulo, valor]) => {
    const item = document.createElement('div');
    const nome = document.createElement('span');
    nome.textContent = rotulo;
    const numero = document.createElement('strong');
    numero.textContent = valor;
    item.append(nome, numero);
    stats.append(item);
  });
}

function svgEl(tag, atributos = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(atributos).forEach(([nome, valor]) => el.setAttribute(nome, String(valor)));
  return el;
}

// Passo "redondo" para as linhas de grade: 0,5 / 1 / 2 / 5 / 10 kg...
function niceStep(bruto) {
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const fracao = bruto / potencia;
  const passo = fracao <= 1 ? 1 : fracao <= 2 ? 2 : fracao <= 5 ? 5 : 10;
  return passo * potencia;
}

// Linha do peso ao longo do tempo, com a meta como referência tracejada. As posições
// são calculadas em pixels reais da largura atual, então círculos não deformam.
function renderWeightChart(logs, alvo) {
  const caixa = document.querySelector('#weight-chart');
  caixa.replaceChildren();
  if (!logs.length) {
    const vazio = document.createElement('p');
    vazio.className = 'empty-state';
    vazio.textContent = weightLogs.length
      ? t('Nenhuma pesagem neste período. Escolha um período maior ou registre seu peso abaixo.')
      : t('Registre seu peso abaixo para começar a acompanhar a evolução.');
    caixa.append(vazio);
    return;
  }

  const largura = Math.max(280, Math.round(caixa.clientWidth || 600));
  const altura = 210;
  const m = { top: 16, right: 16, bottom: 28, left: 44 };
  const plotW = largura - m.left - m.right;
  const plotH = altura - m.top - m.bottom;

  const valores = logs.map((log) => log.weight_kg);
  if (alvo) valores.push(alvo);
  const folga = Math.max(0.5, (Math.max(...valores) - Math.min(...valores)) * 0.15);
  let min = Math.min(...valores) - folga;
  let max = Math.max(...valores) + folga;
  const passo = niceStep((max - min) / 3);
  min = Math.floor(min / passo) * passo;
  max = Math.ceil(max / passo) * passo;

  const t0 = parseDateKey(logs[0].date).getTime();
  const t1 = parseDateKey(logs[logs.length - 1].date).getTime();
  const xDe = (key) => (logs.length === 1 || t1 === t0
    ? m.left + (plotW / 2)
    : m.left + (((parseDateKey(key).getTime() - t0) / (t1 - t0)) * plotW));
  const yDe = (kg) => m.top + ((1 - ((kg - min) / (max - min))) * plotH);

  const atual = logs[logs.length - 1];
  const svg = svgEl('svg', {
    viewBox: `0 0 ${largura} ${altura}`,
    width: '100%',
    height: altura,
    role: 'img',
    'aria-label': t('Peso de {0} a {1}: de {2} para {3}.', formatDayMonth(logs[0].date), formatDayMonth(atual.date), formatKg(logs[0].weight_kg), formatKg(atual.weight_kg)),
  });

  for (let v = min; v <= max + (passo / 2); v += passo) {
    const y = yDe(v);
    svg.append(svgEl('line', { x1: m.left, x2: largura - m.right, y1: y, y2: y, class: 'weight-grid' }));
    const rotulo = svgEl('text', { x: m.left - 8, y: y + 4, class: 'weight-axis', 'text-anchor': 'end' });
    rotulo.textContent = new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 1 }).format(v);
    svg.append(rotulo);
  }

  if (alvo) {
    const y = yDe(alvo);
    svg.append(svgEl('line', { x1: m.left, x2: largura - m.right, y1: y, y2: y, class: 'weight-target-line' }));
    const rotulo = svgEl('text', { x: largura - m.right, y: y - 6, class: 'weight-axis', 'text-anchor': 'end' });
    rotulo.textContent = t('Meta {0}', formatKg(alvo));
    svg.append(rotulo);
  }

  const pontos = logs.map((log) => [xDe(log.date), yDe(log.weight_kg)]);
  if (pontos.length > 1) {
    svg.append(svgEl('path', { d: pontos.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '), class: 'weight-line' }));
  }
  pontos.forEach(([x, y]) => svg.append(svgEl('circle', { cx: x, cy: y, r: 4, class: 'weight-point' })));

  // Rótulos de data só nas pontas (e no meio quando cabe): selecionar, não rotular tudo.
  const marcas = logs.length > 2 ? [0, Math.floor((logs.length - 1) / 2), logs.length - 1] : [...new Set([0, logs.length - 1])];
  marcas.forEach((i) => {
    const anchor = i === 0 && logs.length > 1 ? 'start' : i === logs.length - 1 && logs.length > 1 ? 'end' : 'middle';
    const texto = svgEl('text', { x: pontos[i][0], y: altura - 8, class: 'weight-axis', 'text-anchor': anchor });
    texto.textContent = formatDayMonth(logs[i].date);
    svg.append(texto);
  });

  // Camada de hover: linha vertical + ponto destacado + dica, no ponto mais próximo do cursor/dedo.
  const cruz = svgEl('line', { y1: m.top, y2: altura - m.bottom, class: 'weight-crosshair', visibility: 'hidden' });
  const destaque = svgEl('circle', { r: 6, class: 'weight-point is-active', visibility: 'hidden' });
  svg.append(cruz, destaque);
  const alvoToque = svgEl('rect', { x: m.left - 12, y: 0, width: plotW + 24, height: altura, class: 'weight-hit' });
  svg.append(alvoToque);

  const dica = document.createElement('div');
  dica.className = 'weight-tooltip';
  dica.hidden = true;

  const mostrar = (evento) => {
    const caixaSvg = svg.getBoundingClientRect();
    const xCursor = ((evento.clientX - caixaSvg.left) / caixaSvg.width) * largura;
    let indice = 0;
    pontos.forEach(([x], i) => { if (Math.abs(x - xCursor) < Math.abs(pontos[indice][0] - xCursor)) indice = i; });
    const [x, y] = pontos[indice];
    const log = logs[indice];
    cruz.setAttribute('x1', x);
    cruz.setAttribute('x2', x);
    cruz.setAttribute('visibility', 'visible');
    destaque.setAttribute('cx', x);
    destaque.setAttribute('cy', y);
    destaque.setAttribute('visibility', 'visible');
    const anterior = indice > 0 ? logs[indice - 1] : null;
    dica.replaceChildren();
    const data = document.createElement('span');
    data.textContent = formatLongDay(log.date);
    const peso = document.createElement('strong');
    peso.textContent = formatKg(log.weight_kg);
    dica.append(data, peso);
    if (anterior) {
      const delta = document.createElement('span');
      delta.textContent = t('{0} desde {1}', formatVariation(log.weight_kg - anterior.weight_kg), formatDayMonth(anterior.date));
      dica.append(delta);
    }
    dica.hidden = false;
    const proporcao = x / largura;
    dica.style.left = `${proporcao * 100}%`;
    dica.style.transform = `translateX(${proporcao > 0.7 ? '-100%' : proporcao < 0.3 ? '0' : '-50%'})`;
  };
  const esconder = () => {
    cruz.setAttribute('visibility', 'hidden');
    destaque.setAttribute('visibility', 'hidden');
    dica.hidden = true;
  };
  alvoToque.addEventListener('pointermove', mostrar);
  alvoToque.addEventListener('pointerdown', mostrar);
  alvoToque.addEventListener('pointerleave', esconder);

  caixa.append(svg, dica);
}

// Aviso de recálculo dispensado: some por 7 dias neste aparelho. A chave inclui a conta,
// então duas pessoas usando o mesmo celular não escondem o aviso uma da outra.
const RECALC_DISMISS_DAYS = 7;

function recalcDismissKey() {
  return `nutritrack-recalc-dismissed:${(nutritionProfile && nutritionProfile.id) || 'sem-conta'}`;
}

function isRecalcDismissed() {
  try { return Number(localStorage.getItem(recalcDismissKey())) > Date.now(); } catch { return false; }
}

function dismissRecalc() {
  try { localStorage.setItem(recalcDismissKey(), String(Date.now() + (RECALC_DISMISS_DAYS * 24 * 60 * 60 * 1000))); } catch {}
}

function renderWeightGoal(alvo) {
  const caixa = document.querySelector('#weight-goal');
  caixa.replaceChildren();
  const atual = weightLogs[weightLogs.length - 1];

  if (alvo && atual) {
    const inicio = weightLogs[0].weight_kg;
    const progresso = weightProgress(inicio, atual.weight_kg, alvo);
    const falta = alvo - atual.weight_kg;
    const titulo = document.createElement('p');
    titulo.className = 'weight-goal-text';
    titulo.textContent = Math.abs(falta) < 0.05 || progresso === 100
      ? t('Meta de {0} alcançada.', formatKg(alvo))
      : t('Faltam {0} para a meta de {1}.', formatKg(Math.abs(falta)), formatKg(alvo));
    const barra = document.createElement('div');
    barra.className = 'progress';
    barra.setAttribute('role', 'progressbar');
    barra.setAttribute('aria-valuemin', '0');
    barra.setAttribute('aria-valuemax', '100');
    barra.setAttribute('aria-valuenow', String(progresso));
    barra.setAttribute('aria-label', t('Progresso até o peso-meta'));
    const preenchido = document.createElement('i');
    preenchido.style.width = `${progresso}%`;
    barra.append(preenchido);
    const nota = document.createElement('p');
    nota.className = 'field-note';
    nota.textContent = t('{0}% do caminho desde a primeira pesagem ({1}).', progresso, formatKg(inicio));
    caixa.append(titulo, barra, nota);
  }

  // Peso mudou bastante desde o cálculo das metas: as calorias podem estar defasadas.
  if (atual && isProfileComplete(nutritionProfile) && !isRecalcDismissed()) {
    const diferenca = atual.weight_kg - Number(nutritionProfile.weight);
    if (Math.abs(diferenca) >= 2) {
      const aviso = document.createElement('div');
      aviso.className = 'weight-recalc';
      const texto = document.createElement('span');
      texto.textContent = t('Seu peso mudou {0} desde o último cálculo de metas.', formatVariation(diferenca));
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'text-button';
      botao.append(createIcon('i-target'), document.createTextNode(t('Recalcular metas')));
      botao.addEventListener('click', () => {
        openGoalsDialog(false);
        goalDraft.weight = atual.weight_kg;
        document.querySelector('#goal-weight').value = atual.weight_kg;
      });
      const fechar = createIconButton('i-close', 'ghost-button', t('Dispensar por 7 dias'), () => {
        dismissRecalc();
        aviso.remove();
        showToast(t('Aviso ocultado por 7 dias.'));
      });
      const acoes = document.createElement('span');
      acoes.className = 'weight-recalc-actions';
      acoes.append(botao, fechar);
      aviso.append(texto, acoes);
      caixa.append(aviso);
    }
  }
}

function renderWeightTable() {
  const corpo = document.querySelector('#weight-table-body');
  corpo.replaceChildren();
  [...weightLogs].reverse().forEach((log, i, lista) => {
    const anterior = lista[i + 1];
    const linha = document.createElement('tr');
    const data = document.createElement('th');
    data.scope = 'row';
    data.textContent = formatLongDay(log.date);
    const peso = document.createElement('td');
    peso.textContent = formatKg(log.weight_kg);
    const variacao = document.createElement('td');
    variacao.textContent = anterior ? formatVariation(log.weight_kg - anterior.weight_kg) : '—';
    const acoes = document.createElement('td');
    acoes.append(createIconButton('i-trash', 'ghost-button danger', t('Excluir pesagem de {0}', formatLongDay(log.date)), async () => {
      if (!window.confirm(t('Excluir a pesagem de {0} ({1})?', formatLongDay(log.date), formatKg(log.weight_kg)))) return;
      try {
        await deleteWeightLog(log.id);
        showToast(t('Pesagem excluída.'));
        await loadWeight();
      } catch (error) {
        showToast(t('Não foi possível excluir. {0}', describeDatabaseError(error)), 'error');
      }
    }));
    linha.append(data, peso, variacao, acoes);
    corpo.append(linha);
  });
}

async function handleWeightSubmit(event) {
  event.preventDefault();
  const feedback = document.querySelector('#weight-feedback');
  const botao = document.querySelector('#weight-submit');
  const peso = Number(document.querySelector('#weight-input').value);
  const data = document.querySelector('#weight-date').value;
  if (!validateProfileNumber(peso, PROFILE_LIMITS.weight)) {
    feedback.textContent = t('Informe um peso entre {0} e {1} kg.', PROFILE_LIMITS.weight.min, PROFILE_LIMITS.weight.max);
    return;
  }
  if (!data || data > todayKey()) {
    feedback.textContent = t('Escolha uma data até hoje.');
    return;
  }
  botao.disabled = true;
  feedback.textContent = '';
  try {
    const existia = weightLogs.some((log) => log.date === data);
    await saveWeightLog(data, peso);
    document.querySelector('#weight-input').value = '';
    showToast(existia ? t('Pesagem do dia atualizada.') : t('Peso registrado.'));
    await loadWeight();
  } catch (error) {
    feedback.textContent = t('Não foi possível registrar. {0}', describeDatabaseError(error));
  } finally {
    botao.disabled = false;
  }
}

async function handleTargetSubmit(event) {
  event.preventDefault();
  const bruto = document.querySelector('#weight-target-input').value.trim();
  const alvo = bruto === '' ? null : Number(bruto);
  if (alvo !== null && !validateProfileNumber(alvo, PROFILE_LIMITS.weight)) {
    showToast(t('O peso-meta precisa estar entre {0} e {1} kg.', PROFILE_LIMITS.weight.min, PROFILE_LIMITS.weight.max), 'error');
    return;
  }
  try {
    nutritionProfile = await saveTargetWeight(alvo);
    showToast(alvo === null ? t('Peso-meta removido.') : t('Peso-meta salvo.'));
    renderWeight();
  } catch (error) {
    showToast(t('Não foi possível salvar a meta. {0}', describeDatabaseError(error)), 'error');
  }
}

/* ---------------------------------------------------------
   Refeições e resumo do dia
   --------------------------------------------------------- */

function renderMeals(meals, slots) {
  const list = document.querySelector('#meal-list');
  list.replaceChildren();
  if (!slots.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = t('Você ainda não tem refeições. Use "Personalizar refeições" para criar as suas.');
    list.append(emptyState);
    return;
  }
  const tons = ['breakfast', 'lunch', 'snack', 'dinner'];
  slots.forEach((slot, index) => {
    const items = meals.filter((meal) => String(meal.slot_id) === String(slot.id));
    const calories = items.reduce((sum, meal) => sum + (meal.foods ? calculateNutrition(meal.foods, meal.quantity).calories : 0), 0);

    const card = document.createElement('article');
    card.className = `meal-card${items.length ? '' : ' empty-meal'}`;

    const header = document.createElement('div');
    header.className = 'meal-header';
    const icon = document.createElement('div');
    icon.className = `meal-icon ${tons[index % tons.length]}`;
    icon.append(createIcon(`i-${slot.icon || 'utensils'}`));
    const info = document.createElement('div');
    info.className = 'meal-info';
    const heading = document.createElement('h3');
    heading.textContent = slot.name;
    const description = document.createElement('p');
    description.textContent = items.length
      ? t('{0} {1} · {2} kcal', items.length, items.length === 1 ? t('item') : t('itens'), formatNumber(calories))
      : t('Nada registrado ainda');
    info.append(heading, description);
    header.append(icon, info, createIconButton('i-plus', 'add-small', t('Registrar em {0}', slot.name), () => openEntryDialog(slot.id)));
    card.append(header);

    if (items.length) {
      const entries = document.createElement('ul');
      entries.className = 'meal-items';
      items.forEach((meal) => {
        const row = document.createElement('li');
        const detail = document.createElement('div');
        detail.className = 'ingredient-info';
        const name = document.createElement('strong');
        name.textContent = meal.foods ? foodName(meal.foods) : t('Alimento removido');
        const amount = document.createElement('small');
        const nutrition = meal.foods ? calculateNutrition(meal.foods, meal.quantity) : { calories: 0 };
        amount.textContent = t('{0} · {1} kcal', formatQuantity(meal.quantity, meal.foods), formatNumber(nutrition.calories));
        detail.append(name, amount);
        row.append(detail, createIconButton('i-trash', 'ghost-button danger', t('Remover {0}', name.textContent), async () => {
          try {
            await deleteMeal(meal.id);
            showToast(t('Registro removido.'));
            await refreshDashboard();
          } catch (error) {
            showToast(t('Não foi possível remover. {0}', describeDatabaseError(error)), 'error');
          }
        }));
        entries.append(row);
      });
      card.append(entries);
    }

    list.append(card);
  });
}

/* Personalizar refeições ------------------------------------------------ */

async function loadMealSlots() {
  let slots = await getMealSlots();
  // Conta nova começa com as quatro refeições usuais, que o usuário renomeia depois.
  if (!slots.length) slots = await createDefaultMealSlots();
  mealSlots = slots;
  return slots;
}

function openSlotsDialog() {
  slotDraft = mealSlots.map((slot) => ({ id: slot.id, name: slot.name, icon: slot.icon }));
  if (!slotDraft.length) slotDraft = DEFAULT_MEAL_SLOTS.map((slot) => ({ name: t(slot.name), icon: slot.icon }));
  document.querySelector('#slots-feedback').textContent = '';
  renderSlotDraft();
  openDialog('slots-dialog');
}

function renderSlotDraft() {
  const list = document.querySelector('#slot-list');
  list.replaceChildren();
  slotDraft.forEach((slot, index) => {
    const row = document.createElement('li');
    row.className = 'slot-row';
    row.dataset.index = String(index);

    const handle = document.createElement('button');
    handle.className = 'slot-drag';
    handle.type = 'button';
    handle.setAttribute('aria-label', t('Mover {0}. Use as setas para cima e para baixo.', slot.name || t('refeição')));
    handle.title = t('Arraste para reordenar');
    handle.append(createIcon('i-grip'));
    attachDragReorder(handle, row, (ordem) => {
      slotDraft = ordem.map((posicao) => slotDraft[posicao]);
      renderSlotDraft();
    });
    // Sem ponteiro (teclado, leitor de tela) as setas fazem o mesmo trabalho.
    handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      moveSlotDraft(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
    });

    // O ícone gira pela lista aceita pelo banco a cada clique: escolha visual sem outro menu.
    const iconButton = createIconButton(`i-${slot.icon}`, 'slot-icon', t('Trocar ícone de {0}', slot.name || t('refeição')), () => {
      const atual = MEAL_SLOT_ICONS.indexOf(slot.icon);
      slot.icon = MEAL_SLOT_ICONS[(atual + 1) % MEAL_SLOT_ICONS.length];
      renderSlotDraft();
    });

    const field = document.createElement('span');
    field.className = 'field-control';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 60;
    input.value = slot.name;
    input.placeholder = t('Nome da refeição');
    input.setAttribute('aria-label', t('Nome da refeição {0}', index + 1));
    input.addEventListener('input', () => { slot.name = input.value; });
    field.append(input);

    row.append(handle, iconButton, field, createIconButton('i-trash', 'ghost-button danger', t('Remover {0}', slot.name || t('refeição')), () => {
      const aviso = slot.id
        ? t('Remover "{0}"? Os alimentos já registrados nela serão apagados junto.', slot.name)
        : t('Remover "{0}"?', slot.name || t('esta refeição'));
      if (!window.confirm(aviso)) return;
      slotDraft.splice(index, 1);
      renderSlotDraft();
    }));
    list.append(row);
  });
}

function moveSlotDraft(from, to) {
  if (to < 0 || to >= slotDraft.length) return;
  const [item] = slotDraft.splice(from, 1);
  slotDraft.splice(to, 0, item);
  renderSlotDraft();
  // Devolve o foco ao punho que acabou de se mover, para continuar navegando pelo teclado.
  const handles = document.querySelectorAll('#slot-list .slot-drag');
  if (handles[to]) handles[to].focus();
}

// Arrastar com pointer events cobre mouse e toque; a linha é movida no próprio DOM durante
// o gesto (nada de re-renderizar no meio, que destruiria o elemento sob o dedo) e a ordem
// só volta para o rascunho quando o gesto termina. Cada linha precisa de data-index com a
// posição original; onDrop recebe essas posições na ordem nova.
function attachDragReorder(handle, row, onDrop) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button) return;
    event.preventDefault();
    const list = row.parentElement;
    row.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);

    // Procura o destino pela posição absoluta do ponteiro, e não passo a passo:
    // um arrasto rápido chega de uma vez ao lugar certo em vez de subir uma linha por evento.
    const onMove = (moveEvent) => {
      const y = moveEvent.clientY;
      const alvo = [...list.children].find((sibling) => {
        if (sibling === row) return false;
        const rect = sibling.getBoundingClientRect();
        return y < rect.top + (rect.height / 2);
      });
      if (alvo) {
        if (alvo !== row.nextElementSibling) list.insertBefore(row, alvo);
      } else if (list.lastElementChild !== row) {
        list.append(row);
      }
    };

    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      row.classList.remove('dragging');
      onDrop([...list.children].map((item) => Number(item.dataset.index)));
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });
}

function addSlotDraftRow() {
  slotDraft.push({ name: '', icon: MEAL_SLOT_ICONS[slotDraft.length % MEAL_SLOT_ICONS.length] });
  renderSlotDraft();
  const inputs = document.querySelectorAll('#slot-list input');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

async function handleSlotsSubmit(event) {
  event.preventDefault();
  const feedback = document.querySelector('#slots-feedback');
  const button = document.querySelector('#slots-submit');
  const nomes = slotDraft.map((slot) => slot.name.trim());
  if (!slotDraft.length) {
    feedback.textContent = t('Mantenha pelo menos uma refeição.');
    return;
  }
  if (nomes.some((nome) => !nome)) {
    feedback.textContent = t('Dê um nome a todas as refeições.');
    return;
  }
  if (new Set(nomes.map((nome) => nome.toLowerCase())).size !== nomes.length) {
    feedback.textContent = t('Há nomes repetidos na lista.');
    return;
  }
  button.disabled = true;
  feedback.textContent = '';
  try {
    // Apaga primeiro: libera o nome para ser reaproveitado na mesma gravação.
    const mantidos = new Set(slotDraft.filter((slot) => slot.id).map((slot) => String(slot.id)));
    const removidos = mealSlots.filter((slot) => !mantidos.has(String(slot.id)));
    for (const slot of removidos) await deleteMealSlot(slot.id);
    for (const [index, slot] of slotDraft.entries()) {
      await saveMealSlot({ id: slot.id, name: slot.name.trim(), icon: slot.icon, position: index });
    }
    closeDialog('slots-dialog');
    showToast(t('Refeições atualizadas.'));
    await refreshDashboard();
  } catch (error) {
    feedback.textContent = t('Não foi possível salvar as refeições. {0}', describeDatabaseError(error));
  } finally {
    button.disabled = false;
  }
}

/* Registrar consumo ----------------------------------------------------- */

function openEntryDialog(slotId = null) {
  if (!mealSlots.length) {
    showToast(t('Crie uma refeição antes em "Personalizar refeições".'), 'error');
    return;
  }
  entryQuantityTouched = false;
  document.querySelector('#entry-dialog-title').textContent = selectedDate === todayKey()
    ? t('Registrar consumo')
    : t('Registrar em {0}', formatDayMonth(selectedDate));
  document.querySelector('#entry-food-search').value = '';
  document.querySelector('#entry-feedback').textContent = '';
  fillSlotSelect(slotId);
  fillEntryFoodSelect();
  fillEntryRecipeSelect();
  setEntryMode('food');
  openDialog('entry-dialog');
}

function setEntryMode(mode) {
  entryMode = mode;
  document.querySelectorAll('[data-entry-mode]').forEach((button) => {
    const ativo = button.dataset.entryMode === mode;
    button.classList.toggle('selected', ativo);
    button.setAttribute('aria-selected', String(ativo));
  });
  document.querySelector('#entry-food-mode').hidden = mode !== 'food';
  document.querySelector('#entry-recipe-mode').hidden = mode !== 'recipe';
  document.querySelector('#entry-submit').textContent = mode === 'recipe' ? t('Registrar receita') : t('Registrar');
  document.querySelector('#entry-feedback').textContent = '';
}

function fillSlotSelect(slotId) {
  const select = document.querySelector('#entry-slot');
  select.replaceChildren();
  mealSlots.forEach((slot) => {
    const option = document.createElement('option');
    option.value = String(slot.id);
    option.textContent = slot.name;
    select.append(option);
  });
  if (slotId && mealSlots.some((slot) => String(slot.id) === String(slotId))) select.value = String(slotId);
}

function selectedEntryFood() {
  return foodCatalog.find((food) => String(food.id) === document.querySelector('#entry-food').value);
}

function selectedEntryUnit() {
  const value = document.querySelector('#entry-unit').value;
  return recipeUnitOptions(selectedEntryFood()).find((option) => option.value === value);
}

function fillEntryFoodSelect() {
  const termo = document.querySelector('#entry-food-search').value;
  const matches = matchingFoods(termo);
  populateFoodSelect(document.querySelector('#entry-food'), matches);
  describeMatches(document.querySelector('#entry-food-count'), matches, normalizeText(termo.trim()));
  updateEntryUnit(true);
}

function updateEntryUnit(resetQuantity = false) {
  const food = selectedEntryFood();
  const options = populateUnitSelect(document.querySelector('#entry-unit'), food);
  if (resetQuantity && !entryQuantityTouched) {
    const atual = options.find((option) => option.value === document.querySelector('#entry-unit').value);
    document.querySelector('#entry-quantity').value = defaultQuantityFor(food, atual);
  }
  updateEntryPreview();
}

// Mostra o que será gravado antes de gravar.
function updateEntryPreview() {
  const preview = document.querySelector('#entry-preview');
  const food = selectedEntryFood();
  const option = selectedEntryUnit();
  const digitado = Number(document.querySelector('#entry-quantity').value);
  if (!food || !option || !Number.isFinite(digitado) || digitado <= 0) {
    preview.textContent = t('Selecione um alimento e uma quantidade válida.');
    return;
  }
  const quantidade = Number((digitado * option.factor).toFixed(2));
  const nutrition = calculateNutrition(food, quantidade);
  preview.textContent = t('{0} de {1} = {2} kcal · P {3} g · C {4} g · G {5} g', formatQuantity(quantidade, food), foodName(food), formatNumber(nutrition.calories), formatNumber(nutrition.protein), formatNumber(nutrition.carbohydrates), formatNumber(nutrition.fat));
}

function fillEntryRecipeSelect() {
  const select = document.querySelector('#entry-recipe');
  select.replaceChildren();
  recipeList.forEach((recipe) => {
    const option = document.createElement('option');
    option.value = String(recipe.id);
    option.textContent = recipe.name;
    select.append(option);
  });
  updateEntryRecipePreview();
}

function updateEntryRecipePreview() {
  const preview = document.querySelector('#entry-recipe-preview');
  const recipe = recipeList.find((item) => String(item.id) === document.querySelector('#entry-recipe').value);
  if (!recipe) {
    preview.textContent = t('Você ainda não tem receitas. Crie uma na aba Alimentos.');
    return;
  }
  const items = (recipe.recipe_items || []).filter((item) => item.foods);
  if (!items.length) {
    preview.textContent = t('Esta receita está sem ingredientes.');
    return;
  }
  const totals = calculateRecipeTotals(items);
  preview.textContent = t('{0} {1} · {2} kcal: {3}', items.length, items.length === 1 ? t('item') : t('itens'), formatNumber(totals.calories), items.map((item) => `${foodName(item.foods)} ${formatQuantity(item.quantity, item.foods)}`).join(', '));
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  const feedback = document.querySelector('#entry-feedback');
  const button = document.querySelector('#entry-submit');
  const slotId = document.querySelector('#entry-slot').value;
  if (!slotId) {
    feedback.textContent = t('Escolha em qual refeição registrar.');
    return;
  }
  button.disabled = true;
  feedback.textContent = '';
  try {
    if (entryMode === 'recipe') {
      const recipe = recipeList.find((item) => String(item.id) === document.querySelector('#entry-recipe').value);
      const items = recipe ? (recipe.recipe_items || []).filter((item) => item.foods) : [];
      if (!items.length) {
        feedback.textContent = t('Escolha uma receita que tenha ingredientes.');
        return;
      }
      await addRecipeMeals(items.map((item) => ({ food_id: item.food_id, quantity: Number(item.quantity) })), slotId, selectedDate);
      showToast(t('{0} registrada.', recipe.name));
    } else {
      const food = selectedEntryFood();
      const option = selectedEntryUnit();
      const digitado = Number(document.querySelector('#entry-quantity').value);
      if (!food || !option) {
        feedback.textContent = t('Escolha um alimento.');
        return;
      }
      if (!Number.isFinite(digitado) || digitado <= 0) {
        feedback.textContent = t('Informe uma quantidade maior que zero.');
        return;
      }
      const quantidade = Number((digitado * option.factor).toFixed(2));
      if (quantidade > 100000) {
        feedback.textContent = t('Quantidade muito alta para este alimento.');
        return;
      }
      await addMeal(food.id, quantidade, slotId, selectedDate);
      showToast(t('{0} registrado.', foodName(food)));
    }
    closeDialog('entry-dialog');
    await refreshDashboard();
  } catch (error) {
    feedback.textContent = t('Não foi possível registrar. {0}', describeDatabaseError(error));
  } finally {
    button.disabled = false;
  }
}

function renderNutrition(meals, goals = currentGoals()) {
  const totals = meals.reduce((result, meal) => { const nutrition = meal.foods ? calculateNutrition(meal.foods, meal.quantity) : { calories: 0, protein: 0, carbohydrates: 0, fat: 0 }; Object.keys(nutrition).forEach((key) => { result[key] += nutrition[key]; }); return result; }, { calories: 0, protein: 0, carbohydrates: 0, fat: 0 });
  const values = [['calories', totals.calories, goals.calories], ['protein', totals.protein, goals.protein], ['carbs', totals.carbohydrates, goals.carbohydrates], ['fats', totals.fat, goals.fat]];
  values.forEach(([name, value, goal]) => { const total = document.querySelector(`#${name}-total`); if (total) total.textContent = formatNumber(value); const goalElement = document.querySelector(`#${name}-goal`); if (goalElement) goalElement.textContent = formatNumber(goal); const percent = Math.min(100, Math.round((value / goal) * 100)); const progress = document.querySelector(`#${name}-progress`); if (progress) progress.style.width = `${percent}%`; const percentElement = document.querySelector(`#${name}-percent`); if (percentElement) percentElement.textContent = t('{0}% da meta', percent); });

  const caloriePercent = Math.min(100, Math.round((totals.calories / goals.calories) * 100));
  const ring = document.querySelector('#calorie-ring-progress');
  if (ring) ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - caloriePercent / 100));
  const remaining = document.querySelector('#calories-remaining');
  if (remaining) remaining.textContent = `${formatNumber(Math.max(0, goals.calories - totals.calories))} kcal`;
  const percentLabel = document.querySelector('#calories-share');
  if (percentLabel) percentLabel.textContent = `${caloriePercent}%`;
}

async function refreshDashboard() {
  const [meals, slots] = await Promise.all([getMealsForDate(selectedDate), loadMealSlots()]);
  renderMeals(meals, slots);
  renderNutrition(meals);
  // O gráfico da semana acompanha qualquer registro novo, removido ou de outro dia.
  await loadWeek().catch((error) => showToast(t('Não foi possível atualizar a semana. {0}', describeDatabaseError(error)), 'error'));
}

/* ---------------------------------------------------------
   Ligações de eventos
   --------------------------------------------------------- */

applyTheme(getStoredTheme());

// iPhone/iPad: o Safari amplia a página ao focar um campo e, depois que o teclado fecha,
// não volta à escala original. maximum-scale=1 desliga só esse zoom automático — o iOS
// continua permitindo ampliar com dois dedos. Fica restrito ao iOS porque no Android a
// mesma regra bloquearia a pinça, que é um recurso de acessibilidade.
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

if (isIOS()) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport && !viewport.content.includes('maximum-scale')) {
    viewport.content = `${viewport.content}, maximum-scale=1`;
  }
}

// Quando o teclado fecha, o iOS às vezes deixa a página deslocada para o lado.
// Ao sair de um campo sem entrar em outro, devolve a tela à posição horizontal original.
document.addEventListener('focusout', () => {
  window.setTimeout(() => {
    const ativo = document.activeElement;
    if (ativo && ativo.matches('input, select, textarea')) return;
    if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
  }, 120);
});

document.querySelectorAll('[data-target]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.target)));
document.querySelector('[data-action="edit-slots"]').addEventListener('click', openSlotsDialog);
document.querySelector('[data-action="prev-day"]').addEventListener('click', () => changeSelectedDate(addDaysToKey(selectedDate, -1)));
document.querySelector('[data-action="next-day"]').addEventListener('click', () => changeSelectedDate(addDaysToKey(selectedDate, 1)));
document.querySelector('[data-action="go-today"]').addEventListener('click', () => changeSelectedDate(todayKey()));
document.querySelector('[data-action="open-calendar"]').addEventListener('click', openCalendar);
document.querySelector('[data-action="prev-month"]').addEventListener('click', () => shiftCalendarMonth(-1));
document.querySelector('[data-action="next-month"]').addEventListener('click', () => shiftCalendarMonth(1));
document.querySelector('[data-action="calendar-today"]').addEventListener('click', () => { closeDialog('calendar-dialog'); changeSelectedDate(todayKey()); });
document.querySelector('[data-action="prev-week"]').addEventListener('click', () => shiftWeek(-1));
document.querySelector('#weight-form').addEventListener('submit', handleWeightSubmit);
document.querySelector('#weight-target-form').addEventListener('submit', handleTargetSubmit);
document.querySelectorAll('[data-weight-range]').forEach((botao) => botao.addEventListener('click', () => {
  weightRange = botao.dataset.weightRange;
  renderWeight();
}));
// O gráfico de peso é desenhado na largura real: redesenha quando a tela muda de tamanho.
let weightResizeTimer = null;
window.addEventListener('resize', () => {
  window.clearTimeout(weightResizeTimer);
  weightResizeTimer = window.setTimeout(() => {
    if (document.querySelector('[data-view="progresso"]').classList.contains('active')) renderWeight();
  }, 150);
});
document.querySelector('[data-action="next-week"]').addEventListener('click', () => shiftWeek(1));
// App aberto de um dia para o outro: quem estava em "hoje" passa para o novo hoje,
// senão o próximo registro cairia no dia anterior.
let lastKnownToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const agora = todayKey();
  if (agora === lastKnownToday) return;
  const estavaEmHoje = selectedDate === lastKnownToday;
  lastKnownToday = agora;
  if (estavaEmHoje) changeSelectedDate(agora);
});
document.querySelector('[data-action="log-meal"]').addEventListener('click', () => openEntryDialog());
document.querySelector('#slot-add').addEventListener('click', addSlotDraftRow);
document.querySelector('#slots-form').addEventListener('submit', handleSlotsSubmit);
document.querySelector('#entry-form').addEventListener('submit', handleEntrySubmit);
document.querySelectorAll('[data-entry-mode]').forEach((button) => button.addEventListener('click', () => setEntryMode(button.dataset.entryMode)));
document.querySelector('#entry-food-search').addEventListener('input', fillEntryFoodSelect);
document.querySelector('#entry-food-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
document.querySelector('#entry-food').addEventListener('change', () => updateEntryUnit(true));
document.querySelector('#entry-unit').addEventListener('change', updateEntryPreview);
document.querySelector('#entry-quantity').addEventListener('input', () => { entryQuantityTouched = true; updateEntryPreview(); });
document.querySelector('#entry-recipe').addEventListener('change', updateEntryRecipePreview);
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
document.querySelector('[data-action="new-food"]').addEventListener('click', () => openFoodDialog());
document.querySelector('[data-action="new-recipe"]').addEventListener('click', () => openRecipeDialog());
document.querySelector('[data-action="theme"]').addEventListener('click', toggleTheme);
document.querySelector('[data-action="language"]').addEventListener('click', (event) => {
  event.stopPropagation();
  toggleLanguageMenu();
});
document.querySelectorAll('[data-language]').forEach((botao) => botao.addEventListener('click', () => chooseLanguage(botao.dataset.language)));
// Fecha o menu ao clicar fora ou com Esc, devolvendo o foco ao botão.
document.addEventListener('click', (event) => {
  if (!event.target.closest('.lang-picker')) toggleLanguageMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || document.querySelector('#lang-menu').hidden) return;
  toggleLanguageMenu(false);
  document.querySelector('[data-action="language"]').focus();
});
document.addEventListener('nutritrack:language', rerenderForLanguage);
updateLanguageControls();
document.querySelector('[data-action="profile"]').addEventListener('click', () => showView('perfil'));
document.querySelector('[data-action="logout"]').addEventListener('click', signOut);
document.querySelector('#food-form').addEventListener('submit', handleFoodSubmit);
document.querySelector('#recipe-form').addEventListener('submit', handleRecipeSubmit);
document.querySelector('#recipe-add-item').addEventListener('click', addRecipeItem);
document.querySelector('#recipe-food-search').addEventListener('input', fillRecipeFoodSelect);
// Enter dentro do formulário submeteria a receita: na busca ele não faz nada,
// e no campo de quantidade ele inclui o ingrediente, que é o esperado ali.
document.querySelector('#recipe-food-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
document.querySelector('#recipe-quantity').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addRecipeItem(); } });
document.querySelector('#recipe-quantity').addEventListener('input', () => { recipeQuantityTouched = true; });
document.querySelector('#recipe-food').addEventListener('change', () => updateRecipeUnit(true));
document.querySelector('#recipe-unit').addEventListener('change', applyRecipeQuantityDefault);
document.querySelector('#food-unit').addEventListener('change', handleFoodUnitChange);
document.querySelector('#food-serving').addEventListener('input', updateFoodBaseLabels);
document.querySelector('#auth-form').addEventListener('submit', handleAuthSubmit);
document.querySelector('#auth-switch').addEventListener('click', () => openAuthModal(authMode === 'login' ? 'register' : 'login'));
document.querySelector('#forgot-password').addEventListener('click', () => openAuthModal('forgot'));
document.querySelector('#auth-password').addEventListener('input', (event) => updatePasswordRules(event.target.value));
// Busca no catálogo já carregado: cobre os nomes traduzidos e responde sem esperar a rede.
document.querySelector('#food-search').addEventListener('input', (event) => filterFoodList(event.target.value));
document.querySelector('#profile-form').addEventListener('submit', handleProfileSubmit);
document.querySelector('[data-action="edit-goals"]').addEventListener('click', () => openGoalsDialog(false));
document.querySelector('#goals-form').addEventListener('submit', handleGoalsSubmit);
document.querySelector('#goals-back').addEventListener('click', () => { captureGoalStep(goalStep); if (goalStep > 0) showGoalStep(goalStep - 1); });
// Enquanto o perfil nao estiver completo, Esc nao fecha o questionario.
document.querySelector('#goals-dialog').addEventListener('cancel', (event) => { if (goalsMandatory) event.preventDefault(); });
window.addEventListener('scroll', () => { document.querySelector('.topbar').classList.toggle('is-stuck', window.scrollY > 8); }, { passive: true });
