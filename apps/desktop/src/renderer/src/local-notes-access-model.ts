import type {
  LocalNotesVaultGrant,
  ProjectChatProfile,
  UpdateProjectChatProfileInput,
} from '../../shared/project-chat-contracts';

export function buildLocalNotesGrantUpdate(
  profile: ProjectChatProfile,
  localNotesVault: LocalNotesVaultGrant | null,
): UpdateProjectChatProfileInput {
  return {
    projectId: profile.projectId,
    expectedVersion: profile.version,
    harnessMode: profile.harnessMode,
    responseDepth: profile.responseDepth,
    collaborationModeId: profile.collaborationModeId,
    personality: profile.personality,
    responseVerbosity: profile.responseVerbosity,
    webSearchMode: profile.webSearchMode,
    contextScope: profile.contextScope,
    localNotesVault,
    customInstructions: profile.customInstructions,
    policyRules: profile.policyRules,
  };
}
