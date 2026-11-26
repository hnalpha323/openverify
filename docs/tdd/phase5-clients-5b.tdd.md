# Phase 5, Workflow 5B Stage 2: `clients-5b` (TDD evidence)

C64 for the document, business registry (`database_business`) and business website steps, in the
web flow (`apps/flow`) and in the Kotlin Multiplatform Android SDK (`android/openverify-sdk`). The
NFC step stays the unsupported screen on both clients until Phase 10.

Each section records the RED and GREEN commands as run, with their output abbreviated. The flow
API's 5B routes answer 501 until Stage 3, so the clients test against the in-memory fake API
(`apps/flow/src/testing/fake-flow-api.ts`), the mocked Playwright API
(`apps/flow/e2e/support/mock-flow-api.ts`), Android's `FakeFlowApi`, the golden fixtures and the
frozen schemas.

Baseline before any change (`2d3839f5`):

```
$ pnpm --filter @openverify/flow exec vitest run --coverage.enabled=false
 Test Files  61 passed (61)
      Tests  924 passed (924)
```

## 1. Web flow positions: the document, business registry and website steps run (C64.1)

The three Workflow 5B steps stop being `unsupported`: each runs one attempt at a time with
`stepMaxAttempts` (three by default, C50.1), resumes its initiated attempt with its resource (whose
guidance or `inputs-received` the screen reads), waits on a submitted one, retries with the failed
attempt's hints, and starts a new attempt (not "start again") after a canceled one. The NFC step
stays unsupported until Phase 10. The existing "stops at a $type step" case loses its three
Workflow 5B rows, because C64.1 now runs them (the plan changed the behaviour it checked).

RED:

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/flow-position.test.ts --coverage.enabled=false
       × asks for a first attempt of a document step, with 3 attempts
       × asks for a first attempt of a database_business step, with 3 attempts
       × asks for a first attempt of a business_website step, with 2 attempts
       × resumes an initiated document verification with its guidance
       … (15 failed)
AssertionError: expected { kind: 'unsupported', …(2) } to deeply equal { kind: 'capture', …(5) }
```

GREEN (`flow/flow-position.ts`: the three step types join `VerificationStep` and
`verificationPosition`; `form` and `nfc` stay unsupported):

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/flow-position.test.ts src/flow/flow-renderer.test.tsx --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  111 passed (111)
```

## 2. Web flow: the browser's check of a picked document (C52.4, C64.1)

`lib/document-file.ts` (stub `e112a977`): `checkDocumentFile(file, accepted)` reads at most the
first 1,024 bytes and types the file with the contracts' `detectUploadMimeType('document', …)`
(a `%PDF-` header within the first 1,024 bytes, or JPEG, PNG or WebP magic bytes), refuses an empty
file, one over `maxUploadBytes('document')` (10 MiB) before reading it, and a type the step's
guidance does not accept; `imageMimeTypes(accepted)` gives what a camera capture may take;
`formatFileSize(bytes, language)` writes the size as the user reads it (`Intl.NumberFormat`).

RED:

```
$ pnpm --filter @openverify/flow exec vitest run src/lib/document-file.test.ts --coverage.enabled=false
     × accepts a PDF by its bytes
     × finds a PDF header anywhere in the first 1,024 bytes, as PDF readers do
     × refuses a type the step’s guidance does not accept, such as a PDF for images only
     … (15 failed)
Error: checkDocumentFile is not implemented yet (…)
```

GREEN:

```
$ pnpm --filter @openverify/flow exec vitest run src/lib/document-file.test.ts --coverage.enabled=false
      Tests  15 passed (15)
```

## 3. Web flow: the API client uploads a PDF as `document.pdf` (C52.4)

The fixtures gain a `document` file resource (`application/pdf`, `verification/document`) and a
synthetic `pdfFile()`. An upload is still named after its kind, never the user's file name.

RED:

```
$ pnpm --filter @openverify/flow exec vitest run src/api/flow-api-client.test.ts --coverage.enabled=false
       × names a document after its kind and the type of its bytes, never the user’s own name (C52.4)
AssertionError: expected 'document' to be 'document.pdf' // Object.is equality
      Tests  1 failed | 69 passed (70)
```

GREEN (`api/flow-api-client.ts`: `application/pdf` names its upload `.pdf`):

```
$ pnpm --filter @openverify/flow exec vitest run src/api/flow-api-client.test.ts --coverage.enabled=false
      Tests  70 passed (70)
```

## 4. Web flow: the document step's screen (C60, C64.1)

Stub `d69e9f06`: `steps/document/document-step.tsx` (`DocumentStep`) and
`flow/use-verification-guidance.ts` (`useVerificationGuidance`). Guidance comes only with a
verification (C52.2), and the document step needs it before the user picks a file (the accepted
types, the window, the media types), so the hook makes the attempt's verification in the
background when the screen opens and reads it back (`getVerification`); the screen names the step's
own documents until then. The background request is never shown when it fails: the screen's own
request makes (or finds, C3) the verification again, and both share one request in flight, so
React's double effect in development makes one verification.

The fake flow API learns the Workflow 5B types: a document's guidance derived from its step
(`guidanceOf` replaces it), a `document` file only for an initiated document verification, a
document submitted only with its file (422 otherwise), the business rules (associated persons only
when collected, every `required-inputs` member), and `failures` for `createVerification` and
`uploadFile`. The whole flow suite stays green with it (62 files, 952 tests).

RED:

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/use-verification-guidance.test.tsx --coverage.enabled=false
     × makes the attempt’s verification once when the screen opens and reads its guidance back
     × shares the verification being made with a request the screen sends meanwhile
     × says nothing when the background request fails, and makes it on the screen’s request
      Tests  3 failed | 1 passed (4)
$ pnpm --filter @openverify/flow exec vitest run src/steps/document --coverage.enabled=false
     × asks for one of the accepted documents, each with the window the guidance gives
     × says one day or one page in the singular
     × reads the guidance of the attempt it makes when the screen opens (C52.2)
     × takes only the accepted media types, and a photo from the back camera when the step allows it
     × shows a picked file by its name and size only, never its contents, and moves focus to it
     × uploads the picked document as its sniffed type, submits it, then reads the session
     × shows the server’s 413 refusal of the file and lets the user pick another
     … (20 failed)
      Tests  20 failed | 1 passed (21)
```

The case that passes on the stub (no camera for an upload-only step) guards the opposite of the
camera case.

GREEN (`useVerificationGuidance`, `DocumentStep` with `steps/document/locales/{en,es}.ts`, wired
into the flow's messages; the plural keys of the window and the page limit use i18next's
`_one`/`_other`; formats are joined by `Intl.ListFormat` as a disjunction):

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/document src/flow/use-verification-guidance.test.tsx --coverage.enabled=false
      Tests  25 passed (25)
$ pnpm --filter @openverify/flow exec vitest run --coverage.enabled=false
 Test Files  64 passed (64)
      Tests  977 passed (977)
```

The React Compiler lint refused a ref read during render (the progress record) and a memo over a
derived list; the record is now lazy state and the list is formatted on each render.

### 4b. The renderer routes the document step to its screen

RED (the route held back; the capture position of a document step still fell to the unsupported
screen):

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/flow-renderer.test.tsx --coverage.enabled=false
     × runs a document step from its upload to the completion screen
     × says the verification is being checked, not photos, while a document is processed
     × asks for another document with the reason the last one failed
TestingLibraryElementError: Unable to find role="heading" and name "Upload a document"
      Tests  3 failed | 39 passed (42)
```

GREEN (`flow/flow-renderer.tsx`: a capture position of a document step renders `DocumentStep`):

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/flow-renderer.test.tsx --coverage.enabled=false
      Tests  42 passed (42)
```

## 5. Web flow: the business registry and business website forms (C52.3, C61, C64.1)

Stubs `e941bd7b` and `bc0df77d`: the form step (`EnteredValuesStep`) takes the business registry
and website steps (created with their API types `database-business` and `business-website`), their
titles, fields, hints and messages exist in English and Spanish, and the guidance hook gains an
`eager` option. The business form needs its guidance's `required-inputs` (and
`collect-associated-persons`) before the user types, so its verification is made when the screen
opens; the website form needs none, so its verification is made with the first send, as the
database form's is.

The form mirrors C52.3 with the contract schemas: each member with its own schema; the
registration number against the register of the chosen country (`registrationNumberAccepted`:
Companies House for GB, a CIK for the US, otherwise up to 20 letters and digits), saying that
country's format; an LEI's ISO 7064 check digits (`isLei`); the website URL with
`businessWebsiteInputsSchema`. A 422 pointer at a member the user left empty says what is needed;
at one they filled, that it was refused. Associated persons (0 to 10) are groups of their own
("Person 1"), each pointer `/associated-persons/<i>/<member>` coming back to its person.

RED:

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/forms/business-forms.test.tsx src/flow/flow-renderer.test.tsx src/flow/use-verification-guidance.test.tsx --coverage.enabled=false
     × makes nothing on opening for a screen that needs no guidance before the user acts
     × asks for the business, its country and its optional identifiers, with the registered address grouped
     × checks the registration number against the register of the chosen country, saying its format
     × checks an LEI’s check digits (ISO 17442)
     × adds up to ten people, each in a group of their own, focusing the new person’s first name
     × shows a 422 pointer at a person’s field
     × refuses https://user:secret@example.com as the server would, before sending it
     × runs a business registry step from its form to the completion screen
     … (25 failed)
      8 TestingLibraryElementError: Unable to find an accessible element with the role "textbox" and name "Business name"
      8 TestingLibraryElementError: Unable to find an accessible element with the role "textbox" and name "Website address"
      1 AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
      Tests  25 failed | 47 passed (72)
```

One new case passes on the stub: a resumed business attempt whose values the server holds is sent
for checking, because the stub's `inputs-received` reading covers the four form resources.

GREEN (`fields.ts`: `businessFields`, `businessRequiredMembers`, `collectsPersons`, `personFields`,
`personKey`, `businessBody`, `businessCrossErrors`, `registrationFormat`, `websiteFields`,
`fieldKeyOfPointer`; `EnteredValuesStep` builds the business form with its people and the website
form; the hook honours `eager`; the renderer routes both steps to the form):

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/forms src/flow --coverage.enabled=false
      Tests  251 passed (251)
$ pnpm --filter @openverify/flow exec vitest run --coverage.enabled=false
 Test Files  65 passed (65)
      Tests  1006 passed (1006)
```

## 6. Web flow: the mocked Playwright specs of the document, business and website steps (C64.1)

The mocked API (`e2e/support/mock-flow-api.ts`) learns the three types: their resources in
`STEP_OF_TYPE`, the two forms in `INPUT_TYPES`, a document's PDF sniffed (its header within the
first 1,024 bytes) and sent only to an initiated document verification, a document submitted only
with its file (422), `refusedUploads` for a document upload's refusal (such as 413), the business
rule (persons only when collected, every `businessRequiredInputs` member), and each type's guidance
from its step (`documentGuidance` replaces the document's).

Two specs, `document.spec.ts` (5 tests) and `business.spec.ts` (4 tests: the business form, its
people, the website form, Spanish), check in Chromium what jsdom cannot: the production bundle under
its CSP, the button opening the file chooser (one file), the accessible descriptions as Chromium
computes them (hint then error), focus, the 24 px targets, the upload named `document.pdf`, no
element that could render a file. They were written after the jsdom RED and GREEN of sections 4 and
5 and passed on their first run; they pin the built behaviour in a real browser.

```
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow exec playwright test --config e2e/playwright.config.ts document business
  ✓ e2e/document.spec.ts › uploads a PDF: the guidance read on opening, the accepted types only, the file shown by name and size, never rendered (C60, C64.1) (3.8s)
  ✓ e2e/document.spec.ts › refuses a file that is no accepted type before sending it, and the server’s 413, with focus on its words (C52.4, WCAG 2.2 AA) (1.5s)
  ✓ e2e/document.spec.ts › says the upload is under way in a live region, then asks again with the reason the last document failed (C64.1, C51.2) (720ms)
  ✓ e2e/document.spec.ts › offers no camera when the guidance accepts PDFs only, and names the guidance’s own window and page limit (C52.2, C64.1) (571ms)
  ✓ e2e/document.spec.ts › speaks Spanish (C64.1) (457ms)
  ✓ e2e/business.spec.ts › fills the business form: the guidance’s required inputs marked on opening, the register’s format per country, an LEI’s check digits (C52.3, C61, C64.1) (4.2s)
  ✓ e2e/business.spec.ts › collects the business’s people in groups of their own, with focus on each new one and a 422 pointer back at its person (C52.3, WCAG 2.2 AA) (1.8s)
  ✓ e2e/business.spec.ts › fills the website form: the URL checked as the server does, the verification made only when sending (C52.3, C61.3) (1.7s)
  ✓ e2e/business.spec.ts › speaks Spanish (C64.1) (1.2s)
  9 passed (7.7s)
```

## 7. Android: the document, business registry and website steps (C50.3, C64.2)

Stub `08c8013e`: `DocumentStep(id, documentTypes, captureMethods, maxAttempts?)`,
`DatabaseBusinessStep(id, collectAssociatedPersons?, maxAttempts?)`,
`BusinessWebsiteStep(id, maxAttempts?)` and `DocumentClass` (core `DOCUMENT_TYPES`), not yet in the
step decoder, and shown as unsupported by the flow engine (as they were before).

RED (`model/Phase5BWireModelTest`):

```
$ cd android && ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.Phase5BWireModelTest'
5 tests completed, 2 failed
  FAIL the document, business registry and website steps decode as their own steps (C50_3)
       expected: <[DocumentStep(id=proof, …), DatabaseBusinessStep(id=business, collectAssociatedPersons=true, …), BusinessWebsiteStep(id=website, …)]> but was: <[UnsupportedStep(…)…]>
  FAIL a Workflow 5B step's attempts are its own maxAttempts, else three (C50_1, C50_2)
       expected: <3> but was: <null>
```

Three cases pass on the stub and guard GREEN: the round trip, an unusable value decoding as
unsupported (the NFC step included), and the classes equal to core's list.

GREEN (`FlowStepSerializer` decodes the three; `stepMaxAttempts` gives their own count, else three):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '…Phase5BWireModelTest' --tests '…Phase5WireModelTest' --tests '…FlowCoordinatorTest'
dev.openverify.sdk.model.Phase5BWireModelTest: 5 tests, 0 failures, 0 errors, 0 skipped
```

## 8. Android: guidance, the business and website bodies, their rules, and `DocumentFile` (C52.2-C52.4)

Stub `6870d71e`: `DocumentGuidance`, `DatabaseBusinessGuidance`, `DatabaseBusinessInputs` (with
`AssociatedPersonInputs`, `MAX_ASSOCIATED_PERSONS`), `BusinessWebsiteInputs` (each printing no
value), the input fields `BUSINESS_NAME`, `COUNTRY_CODE`, `REGISTRATION_NUMBER`, `LEI`,
`WEBSITE_URL` with their labels, hints and messages in `strings_business.xml` (English and Spanish),
`PersonField` and `PersonInput`, and the public `DocumentFile(bytes, mimeType)` with `sniff`; the
rules answer no problem and `sniff` nothing.

RED (`model/BusinessInputRulesTest` in commonTest, `model/Phase5BWireModelTest`):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '…Phase5BWireModelTest' --tests '…BusinessInputRulesTest'
21 tests completed, 9 failed
  FAIL a document file refuses an empty, oversized or other file and never prints its bytes
       Expected java.lang.IllegalArgumentException to be thrown, but nothing was thrown.
  FAIL a document is typed by its bytes, a PDF header within its first 1,024 bytes or an image (C52_4)
       expected: <application/pdf> but was: <null>
  FAIL eachAssociatedPersonHasNamesAndABirthMonthOrDate   expected: <{PersonInput(index=2, field=NAME_FIRST)=MISSING, …}> but was: <{}>
  FAIL aWebsiteIsAnHttpOrHttpsUrlOfANamedHostOnAWebPort   www.example.com ==> expected: <{WEBSITE_URL=INVALID}> but was: <{}>
  FAIL anLeiHasTwentyCharactersAndItsCheckDigits          OPENVERIFYSYNTH00180 ==> expected: <{LEI=INVALID}> but was: <{}>
  FAIL aRegistrationNumberIsInTheFormatOfTheChosenCountrysRegister   GB sc123456 ==> expected: <{REGISTRATION_NUMBER=INVALID}> but was: <{}>
  … (9 failed)
```

The cases that pass on the stub pin its complete data classes against the contracts: the guidance
shapes, the kebab-case bodies without absent members and without printed values, every field a
contracts body member, `MAX_ASSOCIATED_PERSONS`, and the media types.

GREEN (`InputRules`: the business body, its persons (`personProblems`) and the website body;
`registrationNumberAccepted`, `isLei` and `isAcceptableWebsiteUrl` as the contracts read them;
`DocumentFile.sniff` and its check that the bytes are of the type):

```
dev.openverify.sdk.model.Phase5BWireModelTest: 13 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.model.BusinessInputRulesTest: 8 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.model.InputRulesTest: 11 tests, 0 failures, 0 errors, 0 skipped
```

The device reads a website URL without a WHATWG parser: it takes the scheme in any case with its
slashes optional, refuses credentials, IPv6 and dotted-quad IPv4 literals, other ports and hosts
without an inner dot, and percent-decodes the host first. Where the readings could differ (an IPv4
address written in hexadecimal), it accepts and lets the server's 422 say so, so it is never
stricter than the server.

## 9. Android: the flow API's document upload and the business bodies (C52.3, C52.4)

Stub `497d8bae`: `FlowApi.uploadDocument(verificationId, document: DocumentFile): FileResource`
(a source break for a host that implements `FlowApi`, as android-5a's five methods were, ADR 0004
decision 7), not yet built in `FlowApiClient` or `OneTimeLinkFlowApi`; the test fake keeps its
document uploads.

RED:

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '…FlowApiClientContractTest' --tests '…OneTimeLinkFlowApiTest'
42 tests completed, 5 failed
  FAIL uploadDocumentSendsTheDocumentKindAndItsBytesNamedAfterItsTypeNeverTheUsersName   kotlin.NotImplementedError: uploadDocument is not built yet (…)
  FAIL enterInputsPostsTheBusinessAndWebsiteBodiesKebabCase   kotlin.NotImplementedError: Not built yet
  FAIL businessAndWebsiteValuesOutsideTheirContractAreRefusedBeforeAnyRequest   DatabaseBusinessInputs(values=<redacted>, associatedPersons=1). Expected an exception of class java.lang.IllegalArgumentException to be thrown, but was kotlin.NotImplementedError
  FAIL verificationIdsThatAreNotVerUlidsAreRefusedBeforeAnyRequest   … but was kotlin.NotImplementedError: uploadDocument is not built yet (.., …)
  FAIL the document upload reaches the session's client with its document (C52_4)   kotlin.NotImplementedError
```

GREEN (`FlowApiClient.uploadDocument`: `kind=document`, then the file named `document.<pdf|jpg|png|webp>`
with its media type and length; `enterInputs` sends the business and website bodies, refusing more
than ten people or a person outside the contract; `OneTimeLinkFlowApi` passes the upload on):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.api.*'
dev.openverify.sdk.api.FlowApiClientContractTest: 35 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.api.OneTimeLinkFlowApiTest: 7 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.api.FlowApiClientTest: 78 tests, 0 failures, 0 errors, 0 skipped
… (every api class green)
```

## 10. Android: the document, business registry and website steps in the flow engine (C60, C61, C64.2)

Stub `f1239fe2`: `FlowState.Document`, `PickedDocument` (its name never printed), `DocumentError`,
the actions `pickDocument`, `refuseDocument`, `discardDocument`, `submitDocument`,
`takeDocumentPhoto`, `backToDocument`, and `submitInputs(values, persons)` with the form's
`collectsPersons` and `personErrors`, through `FlowActions`, the view model and the test doubles; the
engine still shows the three steps as unsupported. The test fake gives a document and a business
verification their guidance at creation (derived from the step; `guidanceOf` replaces it,
`businessRequiredInputs`), takes the two form types, and refuses a document submitted without its
file (422).

RED (`flow/FlowCoordinatorDocumentTest`, `flow/FlowCoordinatorBusinessTest`):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '…FlowCoordinatorDocumentTest'
14 tests completed, 13 failed
  FAIL a document step makes its verification on opening and shows its guidance's classes, window, pages and media types
       expected: <Document(step=DocumentStep(id=proof, …), acceptedTypes=[UTILITY_BILL, BANK_STATEMENT], maxAgeDays=90, maxPages=50, …)> but was: <Unsupported(reason=step document)>
  FAIL the picked document is uploaded as the document kind, submitted, and the decision awaited   … but was: <Unsupported(reason=step document)>
  FAIL taking a photo goes to the camera for the document, and back returns to its screen   … but was: <Unsupported(reason=step document)>
  … (13 failed)
  ok   the NFC step stays the unsupported screen until Phase 10 (C64_2)
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '…FlowCoordinatorBusinessTest'
9 tests completed, 9 failed
  FAIL a business step makes its verification on opening and requires what every match group needs   … but was: <Unsupported(reason=step database_business)>
  FAIL a website's URL is entered with its verification made then, and the verification submitted   … but was: <Unsupported(reason=step business_website)>
  … (9 failed)
```

The NFC case passes on the stub: it pins that the NFC step stays unsupported.

GREEN (`EntrySteps.kt`: `documentState`, the business and website forms, `formInputs` with persons,
`personInputAt`, `BUSINESS_FORM_FIELDS`, `WEBSITE_FORM_FIELDS`; `FlowCoordinator`: an
`entryResolution` that `opens` (a new attempt of a document or business step is made, then the
session read, through `Resolution.Open`), `documentResolution`, `businessResolution`, the document
actions with `sendDocument`, the camera path through the capture screen with `StepWork.kinds` set to
the document kind, and `submitInputs` with persons; a business 422 pointer at a member left out
asks for it):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.*' --tests 'dev.openverify.sdk.ui.*' …
dev.openverify.sdk.flow.FlowCoordinatorDocumentTest: 14 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.flow.FlowCoordinatorBusinessTest: 9 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.flow.FlowCoordinatorTest: 114 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.flow.FlowCoordinatorFormTest: 23 tests, 0 failures, 0 errors, 0 skipped
… (every flow and ui class green)
```

One RED case was corrected during GREEN: the business 422 case typed an LEI whose check digits fail
(`…00180`), so the device refused it before the request the case is about; it now uses the valid
synthetic LEI (`…00181`).

## 11. Android: the document, business registry and website screens (C60, C61, C64.2)

Stubs `247b59c8` and `7344c41a`: `DocumentPicker` (a common interface the host passes in) with
`DocumentPick`, `DocumentStepScreen`, `DatabaseBusinessStepScreen`, `BusinessWebsiteStepScreen`,
the test tags `DOCUMENT_CHOOSE`, `DOCUMENT_PHOTO`, `DOCUMENT_PICKED`, `PAGE_GUIDE`, `PERSON_ADD`
and `person(index, field)`, `CaptureScreen`'s `onBack`, `strings_document.xml` and the persons'
texts in English and Spanish, and `fileSizeText`. The flow screen routes the three states. A
picked file's size is written in SI symbols (B, kB, MB) with the language's decimal separator,
since the Spanish-text test refuses a unit word equal in both languages.

`MessagesTest`'s "only the ID sides, the portrait and the selfie poses have capture copy" gains
`DOCUMENT`: C64.2's camera path for documents takes a photo with the SDK's camera (the plan changed
the behaviour it checked).

RED (`ui/steps/DocumentStepScreenTest`, `ui/steps/BusinessFormScreenTest`, `ui/Phase5BScreensTest`,
`ui/MessagesTest`, `ui/steps/FileSizeTextTest` in commonTest):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '…DocumentStepScreenTest' --tests '…BusinessFormScreenTest' --tests '…Phase5BScreensTest' --tests '…MessagesTest' --tests '…FileSizeTextTest'
44 tests completed, 23 failed
  FAIL it names each accepted document with the guidance's window, the formats and the page limit   … could not find any node that satisfies: (Text … contains 'You can upload one of these:')
  FAIL the file picker opens for the accepted media types, and its document or refusal goes to the actions   … (TestTag = 'openverify:document-choose')
  FAIL a business that collects people adds them one by one, each sent with their fields   … contains 'People who own or run the business'
  FAIL the registration number's help and error follow the register of the chosen country   … contains 'For a UK company, the 8-character Companies House number, …'
  FAIL a document's camera shows its own copy and a page-shaped frame, and goes back to the document step   … contains 'Photograph your document'
  FAIL only the ID sides, the portrait, the selfie poses and a document's photo have capture copy (C52_4, C64_2)   expected: <[…, DOCUMENT]> but was: <[…]>
  FAIL aSizeIsWrittenInBytesKilobytesOrMegabytesWithOneDecimal   expected: <0 B> but was: <>
  … (23 failed)
```

Two cases pass on the stub: the routing of the three states (done in the stub) and an ID side's
camera keeping its card frame without a way back.

GREEN (`DocumentStepScreen` with `documentErrorWords` and `fileSizeText`; `InputForm`'s business
fields (the country of registration chosen by name, the registration number's help and objection by
the chosen country's register, the LEI's and the URL's own words, their keyboards) and its
`PersonDrafts` and `PersonsSection`; `captureCopy(DOCUMENT)`; the capture screen's page-shaped frame
and its way back; the flow screen passes `backToDocument` to a document's camera):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.*'
199 tests completed, 0 failed
```

One RED case was corrected during GREEN: the capture screen does not scroll, so the case presses
"Back to the document step" without scrolling to it first.

## 12. Android: the system document picker (C52.4, C64.2)

Stub `fa220b3d`: `SystemDocumentPicker` (androidMain) and `PickedDocuments.load(name, mediaTypes, open)`.
The picked file is read as it is, never re-encoded (unlike the sandbox photo fallback): a PDF stays
a PDF, and a photo keeps the bytes the server's document checks read (C60.1 `image`).

RED (`ui/PickedDocumentsTest`, and `OpenVerifyInquiryActivityTest`'s new case for the wiring):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '…PickedDocumentsTest' --tests '…OpenVerifyInquiryActivityTest'
15 tests completed, 5 failed
  FAIL a PDF is read as it is, with its own name and size   expected: <Picked(document=PickedDocument(DocumentFile(application/pdf, 20 bytes), name=<redacted>, size=20))> but was: <Refused(error=UNREADABLE)>
  FAIL a file is refused when empty, over 10 MiB, of a type the step does not accept, or unreadable   expected: <Refused(error=EMPTY)> but was: <Refused(error=UNREADABLE)>
  FAIL exactly 10 MiB is accepted   expected: <true> but was: <false>
  FAIL a document step can choose a file through the system document picker (C64_2)   … (TestTag = 'openverify:document-choose')
```

GREEN (`SystemDocumentPicker`: `ActivityResultContracts.OpenDocument` with the step's media types,
the display name from `OpenableColumns`, the file read off the main thread; `PickedDocuments.load`;
`OpenVerifyInquiryActivity` passes `documentPicker = SystemDocumentPicker`):

```
dev.openverify.sdk.ui.PickedDocumentsTest: 4 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.OpenVerifyInquiryActivityTest: 11 tests, 0 failures, 0 errors, 0 skipped
```

## 13. Android: the view model's new actions (pins written after the code)

`InquiryViewModel` forwards the document actions and the business form's persons to the coordinator
(added with the stub `f1239fe2`, thin forwarding). Two cases pin that, written after the code, so
they never failed first:

```
dev.openverify.sdk.InquiryViewModelTest: 24 tests, 0 failures, 0 errors, 0 skipped
```

## 14. Final gates (foreground)

```
$ pnpm --filter @openverify/flow typecheck     # tsc --noEmit && tsc --noEmit -p e2e: clean
$ pnpm --filter @openverify/flow lint          # eslint .: clean
$ pnpm --filter @openverify/flow test
 Test Files  65 passed (65)
      Tests  1006 passed (1006)
All files          |   96.34 |    89.87 |   96.95 |   96.38 |
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e
  68 passed (17.9s)
$ pnpm format:check
All matched files use Prettier code style!
$ (cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 1m 28s
SDK host tests: 1256 in 70 classes, 0 failed, 0 skipped; demo app: 18
Kover (openverify-sdk): lines 97.64%, instructions 91.83%, branches 73.78%
lint: only the existing dependency-version and target-API warnings
$ flock /tmp/openverify-e2e.lock pnpm e2e      # exit 0 in 457 s
@openverify/flow:e2e:   68 passed (18.7s)
@openverify/e2e:e2e:   60 passed (7.3m)
```

Counts against the start: flow unit tests 924 to 1,006; mocked flow specs 59 to 68; SDK host tests
1,177 to 1,256.
