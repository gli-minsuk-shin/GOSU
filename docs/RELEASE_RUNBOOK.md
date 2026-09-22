# GOSU 로컬 릴리스·앱 교체·복구 절차

대상: macOS의 로컬 개발 빌드. 인터넷 배포·notarized release·자동 업데이트 절차가 아니다.
항상 [유지보수 가이드](MAINTENANCE_GUIDE.md)와 [AGENTS.md](../AGENTS.md)를 먼저 읽는다.

## 1. 현재 상태 확인

```sh
git status --short
git log -1 --format='%H %cs %s'
/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' /Applications/GOSU.app/Contents/Info.plist
```

- source version은 [Desktop package](../apps/desktop/package.json)가 원본이다.
- 설치 version은 설치본 Info.plist와 실제 앱 header를 확인한다. 빌드했다고 설치된 것은 아니다.
- 미커밋 파일도 local package에 포함될 수 있다. Git HEAD만을 release source라고 기록하지 않는다.
- active turn, 승인창, unsaved editor를 확인한다. 실행 중인 연구 작업을 강제 종료하지 않는다.
- 기존 앱 binary 백업 위치와 이번 설치 staging 위치를 정확히 정한다.

## 2. 문서와 검증

1. version을 올리고 `docs/releases/<version>.md`에 candidate 상태를 쓴다.
2. 변경에 맞는 focused test를 추가/수정하고 실제 실패 재현과 수정 후 성공을 확인한다.
3. `pnpm check`를 실행한다. 이는 format, generated contracts, lint, typecheck, workspace tests,
   root script tests, production builds를 포함한다.
4. `pnpm test:agent-runtime`은 release 때 별도로 실행한다. runtime/context/memory 변경이면 필수다.
5. UI 변경의 real-render smoke를 실행한다. 현재 주요 명령:

```sh
pnpm --filter @gosu/desktop smoke:typography:mac
pnpm --filter @gosu/desktop smoke:notifications:mac
pnpm --filter @gosu/desktop smoke:sidebar-icons:mac
pnpm --filter @gosu/briefing-lab smoke:visual:mac
```

모든 visual gate를 무조건 같은 결과로 간주하지 않는다. 변경 surface에 필요한 것을 선택하고
스크린샷을 실제로 본다. 테스트 중 생성되는 fixture Git commit/push는 임시 local repository일 수
있으며, 이를 사용자 GOSU repo의 Git push로 보고하면 안 된다.

실환경 test의 skip 이유를 남긴다. 현재 Desktop의 일반 gate에는 MacTeX opt-in 5개,
Linux-only 1개, live Claude/Hermes opt-in 각 1개가 조건부로 제외될 수 있다.
권한/계정이 필요한 live test를 자동으로 켜서 요금을 쓰거나 credentials를 바꾸지 않는다.
조건이 달라지면 실제 최신 test output의 숫자를 다시 확인한다.

## 3. 패키징과 bundle 검증

이번 로컬 교체에는 directory package면 충분하다.

```sh
pnpm --filter @gosu/desktop package:mac:dir:dev
```

DMG가 필요하면 `pnpm app:package`를 사용한다. 실제 배포용은
`pnpm app:package:release`이며 signing/notarization credentials를 별도로 갖춰야 한다.
local package 경로에서 Developer ID가 있는 것처럼 보고하지 않는다.

0.58.25부터 afterPack에서 `CalendarBridge.app`을 Resources 안에 컴파일한다. 로컬 고정
서명 전환에서는 본체뿐 아니라 이 helper의 인증서 서명과 designated requirement도 검증한다.
설치 앱은 이 고정 경로를 쓰며 helper가 빠진 packaged build를 임시 ad-hoc helper로 대체하지
않는다. 개발 directory package의 `identity=-`는 검증용이며 그대로 설치하지 않는다.

packager가 반환한 **정확한** .app 경로를 확인한다. Apple Silicon의 보통 경로는
`apps/desktop/dist/mac-arm64/GOSU.app`이지만, 아키텍처에 따라 달라질 수 있으므로 검증 전에는
자동으로 추정하지 않는다. 다음은 경로가 확인된 후의 예시다.

```sh
/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' apps/desktop/dist/mac-arm64/GOSU.app/Contents/Info.plist
codesign --verify --deep --strict --verbose=2 apps/desktop/dist/mac-arm64/GOSU.app
node scripts/verify-packaged-app-startup.mjs apps/desktop/dist/mac-arm64/GOSU.app
shasum -a 256 apps/desktop/dist/mac-arm64/GOSU.app/Contents/Resources/app.asar
```

[packaged-startup verifier](../scripts/verify-packaged-app-startup.mjs)는 Main과 packaged resource를
로드하는 격리 smoke다. DB·Keychain·network·일반 renderer를 열지 않으므로 **사용자 workspace의
실제 시작 성공을 대신하지 않는다.** 두 확인을 구분해 기록한다.

0.58.135부터 이 verifier는 smoke 앞에서 `app.asar`의 `out/model-lab/assets`와 `out/briefing-lab/assets`를
[검사](../scripts/lab-bundles.mjs)한다. `index.html`과 그것이 불러오는 번들 어디에서도 참조되지 않는 `.js`·`.css`가
있으면 개수와 경로를 보여 주며 실패한다(이전 빌드의 번들이 패키지에 실린 것). 실패하면 패키지를 고치지 말고
`pnpm --filter @gosu/desktop build`가 두 Lab 폴더를 새로 복사하는지부터 확인한 뒤 다시 패키징한다.

Hermes bundle은 [prepare script](../scripts/prepare-hermes-runtime.mjs)와 manifest 검증을 통과해야 한다.
runtime을 새로 받거나 API key를 넣는 것이 아니다. production bundle 요구사항을 development
fallback 검증으로 충족했다고 말하지 않는다.

## 4. 앱 교체

2026-09-11 이후 필수: 종료·교체 전에 아래 읽기 전용 gate를 통과한다.

```sh
pnpm app:verify-update /Applications/GOSU.app apps/desktop/dist/mac-arm64/GOSU.app
```

ad-hoc/cdhash 후보나 변경된 서명 신원이면 **설치 중단**이다. 같은 앱 ID와 데이터 경로만
유지해도 OS 권한이 유지된다고 가정하지 않는다. 고정 인증서가 없는 현재 환경에서는 개발
패키지는 테스트용으로만 만들고 설치하지 않는다. 인증서·개인키 생성/설치는 사용자와 별도로
협의한다. 사용자와 일회성 서명 전환 및 OS 재승인을 검토한 경우에만
`--allow-reviewed-identity-migration`을 사용할 수 있다. 이 옵션도 ad-hoc 후보는 거부한다.
설정 파일·DB·TCC·Keychain ACL은 교체 대상으로 삼지 않는다.

사용자가 생성한 로컬 서명 인증서가 generic trust policy에서 untrusted로 표시돼도 명시적
인증서 지문으로 signing/DR 검증이 가능할 수 있다. `scripts/sign-local-mac.mjs`는 개발 후보를
그 인증서로 서명하고 본체/helper의 strict 검증과 지문을 확인한다. Developer ID 자동 선택만
사용하지 않을 뿐 cryptographic 검증을 끄지 않는다. 시스템 루트 신뢰나 Keychain ACL을
변경하지 않으며, OS 개인키 사용 요청은 사용자가 직접 승인한다. 실제 배포용 공증과 구분한다.

다음은 고정된 원칙이다. 승인받지 않은 임의 .app이나 broad directory에는 적용하지 않는다.

1. 현재 앱이 idle인지 확인하고 macOS의 정상 Quit을 요청한다. 종료 확인 전 덮어쓰지 않는다.
2. `/Applications` 아래 `mktemp -d`로 이번 작업 전용 staging directory를 만든다.
3. `ditto`로 검증된 build를 그 staging directory의 `GOSU.app`에 복사한다.
4. staging의 version, code signature와 `app.asar` SHA-256을 다시 비교한다.
5. 기존 `/Applications/GOSU.app`을 아래 backup root의 **존재하지 않는 새 이름**으로 이동한다:
   `Library/Application Support/GOSU/app-backups/GOSU-before-<new-version>-<timestamp>.app`.
6. 검증한 staging 앱을 `/Applications/GOSU.app`으로 이동한다. 실패하면 target과 backup의
   존재를 먼저 확인하고, 빈 target에 한해서만 이전 앱을 복구한다.
7. 설치본의 version/hash/signature와 isolated startup을 다시 확인한다.
8. 실제 `/Applications/GOSU.app`을 열고 header version, Settings, 주요 UI 표시를 확인한다.
9. staging이 비어 있다면 정확한 그 directory만 `rmdir`로 제거한다. 광범위한 `rm -rf`는 필요 없다.

`Library/Application Support/@gosu/desktop`의 DB/Model Lab/설정은 앱 교체 대상이 아니다.
standalone Model Lab/Briefing Lab의 브라우저 저장소도 지우지 않는다.

### macOS Safe Storage 승인

ad-hoc signature가 바뀌면 기존 `Electron Safe Storage` 항목에 대한 OS 승인이 필요할 수 있다.
이때 비밀번호는 사용자가 **macOS dialog에 직접** 입력한다. assistant에게 비밀번호를 전달받거나,
SecurityAgent를 자동으로 조작하거나, Keychain ACL을 약화하거나, key를 평문 파일로 옮기지 않는다.
승인 대기로 실제 UI 검증이 막히면 설치 성공과 UI 확인 대기를 나눠 보고한다.

## 5. 복구

- 이전 binary는 release note에 기록한 정확한 backup 경로에서 찾는다.
- 새 앱을 정상 종료하고 실패한 새 binary도 별도 보관한다. 이전 앱을 target에 복구한 뒤
  signature/version/isolated startup과 실제 UI를 확인한다.
- binary rollback은 DB schema rollback이 아니다. schema migration이 있었다면 호환성을 검토하고
  적절히 보호된 data backup을 이용해야 한다. SQLite/Keychain 파일을 임의로 삭제하지 않는다.
- 여러 GOSU 프로세스로 같은 user data를 동시에 열지 않는다.

## 6. 종료 시 남길 기록

release note에 다음을 실제 확인값으로 적는다:

- source version, Git HEAD, dirty/committed 상태. commit/push는 사용자 요청이 있어야 수행한다.
- source .app, target .app, backup, `app.asar` SHA-256.
- focused/full test 숫자, 환경 skip 이유, type/lint/format/build, smoke 결과.
- 실제 실행 UI의 version 및 이번 동작 확인. 확인하지 못했으면 그 이유.
- 독립 prototype의 주소/시작 명령과 packaged 포함 여부.
- 알려진 문제가 해결됐는지, 단지 문서에 기록된 것인지.

모든 변경 Markdown을 Obsidian Vault의 `GOSU/repository-docs`에 같은 상대 경로로 복사하고
`cmp`로 byte-identical을 확인한다. `node --test scripts/maintenance-docs.test.mjs`와
`pnpm format:check`를 마지막으로 실행한다.
