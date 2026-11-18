# Modelo de dados do Firestore

## Convenções

- Todas as coleções pertencem a um colégio. Cada documento persistido pela API traz `schoolId` e `schemaVersion: 1`.
- O bootstrap inicial usa `schoolId: "default"`; outro colégio deve receber seu próprio identificador, único e estável. O identificador de colégio é uma fronteira de autorização, não um rótulo de interface.
- Datas de consulta usam Firestore `Timestamp` (UTC). A interface formata as datas para `pt-BR` e considera Fortaleza nos resumos de “hoje”.
- IDs Firebase Authentication são usados como `users/{uid}` e como `userId` nos vínculos.
- A API usa Firebase Admin, portanto as regras do Firestore não são executadas nas leituras e gravações do servidor. As rotas verificam ID token, perfil, colégio, vínculo e relação com a aula. O navegador não recebe acesso direto às coleções.

## Coleções

### `users/{uid}`

Perfil de aplicação ligado ao usuário Firebase Authentication.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `schoolId` | string | Obrigatório em dados novos; define o colégio. |
| `schemaVersion` | number | `1`. |
| `displayName`, `email` | string | Nome e e-mail do perfil. |
| `role` | string | `coordination`, `teacher` ou `student`. Apenas a Coordenação cria perfis de professor/estudante pela API. |
| `registration` | string | Matrícula; obrigatória para estudante. |
| `guardian` | map | Para estudante: `name`, `email?`, `phone?`. Contato só é usado em etapas futuras de comunicação. |
| `classIds` | string[] | Índice legado/materializado para compatibilidade; `class_memberships` é o vínculo canônico. |
| `teachingAssignments` | map[] | Para professor: atribuições por turma, com `classId` e `subjects[]`; refletidas também em `class_memberships`. |
| `createdAt`, `updatedAt` | Timestamp | Auditoria básica. |

O primeiro perfil `coordination` é criado no Console Firebase. Nunca aceite `role` enviado pelo próprio cliente de login como fonte de autorização; a API lê o documento de perfil.

### `classes/{classId}`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `schoolId`, `schemaVersion` | string, number | Identidade do colégio e versão do documento. |
| `name`, `shift` | string | Nome e turno. |
| `subjects` | string[] | Disciplinas habilitadas para a turma. |
| `location` | map | Opcional, mantido para compatibilidade com turmas antigas. A geocerca de novas aulas fica em `lessons.location`. |
| `status` | string | `active` ou `archived`. Ausência significa turma ativa para compatibilidade. Excluir arquiva a turma para preservar o histórico. |
| `archivedAt`, `archivedBy` | Timestamp, string | Auditoria de arquivamento. Turmas arquivadas saem das listas e não recebem novas aulas ou vínculos. |
| `schedule` | map[] | `weekday` (0–6), `startsAt`, `endsAt`, `subject`, `teacherId?`. Preparado para horários; chamadas atuais iniciam no momento da ação do professor. |
| `createdBy`, `createdAt`, `updatedAt` | string, Timestamp | Auditoria. |

`teacherIds` e `studentIds` são aceitos apenas como campos antigos durante a migração; documentos novos usam `class_memberships`.

### `environments/{environmentId}`

Sala ou espaço escolar predefinido pela Coordenação. Um ambiente pertence a uma turma e pode ser escolhido pelo professor ao abrir uma aula, como alternativa à captura da localização atual.

Campos: `schoolId`, `schemaVersion`, `name`, `classId`, `schedule[]` (`weekday` 0–6, `startsAt`, `endsAt`), `location` (`latitude`, `longitude`, `radiusMeters` entre 20 e 1000), `createdBy`, `createdAt`, `updatedAt`. Se a turma for arquivada, o ambiente também recebe `archivedAt` e deixa de ser oferecido para novas chamadas.

### `class_memberships/{classId}_{uid}`

Relação única entre uma pessoa e uma turma. O ID determinístico evita vínculos duplicados.

Campos: `classId`, `userId`, `schoolId`, `role` (`teacher` ou `student`), `schemaVersion`, `createdAt`, `createdBy`.

### `lessons/{lessonId}`

Uma chamada por turma e disciplina. Apenas uma chamada ativa por turma.

Campos: `schoolId`, `schemaVersion`, `classId`, `subject`, `teacherId`, `mode` (`in-person` ou `remote`), `status` (`active` ou `closed`), `startsAt`, `endsAt?`, `presentCount`, `qrNonce`, `qrExpiresAt`, `createdAt`, `updatedAt`, `closedAt?`.

Para aulas presenciais, a API grava também `location` (`latitude`, `longitude`, `radiusMeters`) e `locationMode` (`current` ou `environment`); quando vem de uma sala cadastrada, grava `environmentId`. Assim, a geocerca pertence à aula e não fica imposta na turma. O coordenador pode atualizar os dados de professores e estudantes, os vínculos, e remover contas; os registros históricos de frequência permanecem.

O QR contém apenas um token HMAC com `lessonId`, `classId`, `schoolId`, nonce aleatório e validade de dez segundos. A tela renova o código pouco antes do vencimento. Um código já exibido continua aceito até o vencimento contido em sua assinatura, mesmo após a emissão do próximo código; o token também precisa corresponder a uma aula ativa e à turma indicada. `qrNonce` e `qrExpiresAt` são estado do código mais recente, não histórico de tokens.

### `attendance/{lessonId}_{studentUid}`

Um registro atual por estudante/aula. A chave composta e uma transação impedem registros duplicados concorrentes.

Campos: `schoolId`, `schemaVersion`, `lessonId`, `classId`, `studentId`, `status` (`present`, `absent`, `justified`), `method` (`qr`, `manual`), `markedBy`, `recordedAt`, `updatedAt?`, `note?`, `location?`.

`location` guarda somente `{ verified, distanceMeters, accuracyMeters }`. Latitude e longitude recebidas do aparelho são usadas para validar a geocerca, mas não são persistidas. No fechamento da aula, estudantes sem registro recebem `status: absent` e `absenceReason: not-marked-before-close`.

### `attendance_events/{eventId}`

Histórico imutável das alterações manuais: `schoolId`, `lessonId`, `classId`, `studentId`, `previousStatus`, `newStatus`, `note?`, `changedBy`, `createdAt`, `schemaVersion`. O documento corrente de `attendance` pode mudar; o evento registra cada correção feita durante uma chamada ativa.

### `protocols/{protocolId}`

Orientação pedagógica por estudante: `schoolId`, `schemaVersion`, `classId`, `studentId` (UID do documento `users/{uid}` e da conta Firebase Authentication), `studentName` (cópia para histórico), `className` (cópia para histórico), `title`, `description`, `dueAt?`, `status` (`open` ou `resolved`), `createdBy`, `createdAt`, `updatedAt`, `resolvedAt?`. Consultas e resolução autorizam pelo `studentId`, nunca pelo nome.

O estudante consulta e conclui seus próprios protocolos. A gravação não envia e-mail, SMS ou notificação push.

### `activities/{activityId}`

Atividade da agenda escolar vinculada a `schoolId`, `classId`, `className`, `subject`, `teacherId` e `teacherName`. Contém `title`, `description`, `dueAt` (Timestamp), `status` (`active` ou `archived`) e datas de criação/atualização. Professores só publicam e editam atividades em turmas e disciplinas às quais estão vinculados; estudantes consultam apenas atividades das próprias turmas.

### `activity_completions/{activityId}_{studentUid}`

Registro da entrega/conclusão pelo aluno, com `activityId`, `schoolId`, `classId`, `studentId` e `submittedAt`. O status pendente/atrasado/entregue é calculado a partir da data limite e deste registro.

### `grade_submissions/{submissionId}`

Lote de notas de uma turma, disciplina e professor, com `academicYear`, `term`, `gradeLabels`, `entries` (UID, nome e matrícula do aluno, notas parciais e média) e status `draft`, `pending`, `approved` ou `rejected`. O professor edita somente rascunhos e devoluções; a Coordenação revisa somente lotes pendentes. A devolução exige feedback.

### `student_grades/{submissionId}_{studentUid}`

Projeção das notas publicadas para o boletim, com UID do estudante, turma, disciplina, professor, período, notas, média e `approvedAt`. Somente a aprovação do lote cria/atualiza esses documentos; a API do boletim consulta pelo UID do estudante autenticado.

## Relações

```text
users ──< class_memberships >── classes
                               ├──< environments
                               ├──< lessons ──< attendance >── users
                               │                  └── attendance_events
                               ├──< protocols >── users
                               ├──< activities ──< activity_completions >── users
                               └──< grade_submissions ──< student_grades >── users
```

`attendance` é o livro de frequência. Os percentuais da interface são calculados sobre aulas lançadas: presença ÷ (presença + falta); `justified` fica fora do denominador. O painel da Coordenação sinaliza abaixo de 75% depois de pelo menos cinco registros em 30 dias.

## Geolocalização

1. Ao preparar uma aula, o professor captura a localização atual ou seleciona um ambiente predefinido da turma.
2. A API grava essa geocerca na aula; turmas antigas ainda podem fornecer `location` como fallback.
3. O estudante permite localização no dispositivo e lê o QR presencial.
4. A API valida a assinatura/expiração do QR, o vínculo com turma, a chamada ativa e a distância até a geocerca da aula.
5. Se a localização da aula não foi definida, está imprecisa ou está fora do raio, a API recusa a chamada e não cria um registro.

O valor de raio é uma escolha operacional: GPS de celulares pode ser menos preciso em áreas internas. A equipe deve ajustar o raio e validar em sala antes de usar a frequência como registro oficial.

## Índices compostos

Os índices necessários estão versionados em `firestore.indexes.json` e conectados por `firebase.json`. Eles cobrem consultas de membros por pessoa/turma, aulas ativas e recentes, frequência por aluno/turma/colégio e protocolos por estudante/colégio. Se uma consulta nova exigir outro índice, o Firestore retorna o link para criar o índice; adicione-o ao arquivo versionado antes de publicar.

## Migração da primeira versão

O projeto anterior documentava `classIds` em usuários, `teacherIds/studentIds` em turmas e datas ISO como strings. A migração em `apps/api/src/scripts/migrate-firestore.ts` cria `class_memberships`, adiciona `schoolId`/`schemaVersion` e converte os campos de data para Firestore Timestamp. Ela deduplica vínculos pelo ID determinístico.

`db:migrate:check` faz leitura e mostra somente contagens. `db:migrate:apply` grava em lotes de até 400 documentos. A migração foi executada no projeto configurado; o Firestore estava vazio, então não houve documentos para converter. Os índices compostos foram publicados; as regras do cliente ainda precisam ser publicadas no projeto de destino.
