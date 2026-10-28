import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
const catalog = {
  users: ['Пользователи', 'UserCreateDto', 'UserPatchDto'],
  curators: ['Кураторы', 'CuratorAssignDto', null],
  regions: ['Регионы', 'RegionDto', 'RegionPatchDto'],
  places: ['Учреждения', 'PlaceWriteDto', 'PlacePatchDto'],
  events: ['Мероприятия', 'EventWriteDto', 'EventPatchDto'],
  'open-days': ['День открытых дверей', 'OpenDayWriteDto', 'OpenDayPatchDto'],
  news: ['Новости', 'NewsWriteDto', 'NewsWriteDto'],
  pages: ['Страницы', 'PageWriteDto', 'PageWriteDto'],
  albums: ['Альбомы', 'AlbumWriteDto', 'AlbumWriteDto'],
  'media-items': ['Фото и видео', 'MediaItemWriteDto', 'MediaItemWriteDto'],
  interviews: ['Интервью', 'InterviewWriteDto', 'InterviewWriteDto'],
  projects: ['Проекты', 'ProjectWriteDto', 'ProjectWriteDto'],
  partners: ['Партнеры', 'PartnerWriteDto', 'PartnerWriteDto'],
  press: ['СМИ', 'PressWriteDto', 'PressWriteDto'],
  'club-reports': ['Отчеты Клуба', 'ClubReportWriteDto', 'ClubReportWriteDto'],
  donations: ['Пожертвования', 'DonationWriteDto', 'DonationWriteDto'],
  'contact-requests': ['Обращения', null, 'ContactPatchDto'],
};
const root = new URL('../', import.meta.url);
const spec = JSON.parse(await readFile(new URL('packages/shared/openapi.json', root), 'utf8'));
const lines = [
  '// Generated from OpenAPI. Regenerate with pnpm gen:client.',
  "import { api, result } from './api/client';",
  "import { schemaFor } from './form-schema';",
  "import type { TableQuery } from '@/components/data-table';",
  'export const resources = {',
];
for (const [name, [title, create, update]] of Object.entries(catalog)) {
  const path = '/api/v1/admin/' + name;
  if (!spec.paths[path]) throw new Error(`Missing API contract: ${path}`);
  lines.push(
    `${JSON.stringify(name)}:{title:${JSON.stringify(title)},createSchema:${JSON.stringify(create)},updateSchema:${JSON.stringify(update)},`,
  );
  lines.push(
    `list:(query:TableQuery & Record<string,string|number|boolean|undefined>)=>result(api.GET('${path}',{params:{query}})),`,
  );
  if (create)
    lines.push(
      `create:(body:unknown)=>result(api.POST('${path}',{body:schemaFor('${create}').parse(body)})),`,
    );
  if (update)
    lines.push(
      `update:(id:string,body:unknown)=>result(api.PATCH('${path}/{id}',{params:{path:{id}},body:schemaFor('${update}').parse(body)})),`,
    );
  if (spec.paths[path + '/{id}']?.delete)
    lines.push(`remove:(id:string)=>result(api.DELETE('${path}/{id}',{params:{path:{id}}})),`);
  lines.push('},');
}
lines.push('} as const;');
await writeFile(
  new URL('apps/web/src/lib/resources.ts', root),
  await format(lines.join('\n'), { parser: 'typescript', singleQuote: true, printWidth: 100 }),
);
const schemaNames = new Set(
  Object.values(catalog)
    .flatMap(([, create, update]) => [create, update])
    .filter(Boolean),
);
for (const name of [
  'TripCreateDto',
  'TripPatchDto',
  'TripStatusDto',
  'ReportWriteDto',
  'NeedsWriteDto',
  'SettingsWriteDto',
  'OverridesDto',
])
  schemaNames.add(name);
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') {
    const name = value.$ref.split('/').pop();
    if (!schemaNames.has(name)) {
      schemaNames.add(name);
      visit(spec.components.schemas[name]);
    }
  }
  for (const child of Object.values(value)) visit(child);
}
for (const name of schemaNames) {
  if (!spec.components.schemas[name]) throw new Error(`Missing form schema: ${name}`);
  visit(spec.components.schemas[name]);
}
const formDefinitions = Object.fromEntries(
  [...schemaNames].sort().map((name) => [name, spec.components.schemas[name]]),
);
await writeFile(
  new URL('apps/web/src/lib/form-definitions.json', root),
  await format(JSON.stringify(formDefinitions), { parser: 'json', printWidth: 100 }),
);
console.log('Сгенерированы контракты форм и привязки API.');
