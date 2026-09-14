import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:google_sign_in/google_sign_in.dart';

/// Google Sign-In only proves which Google account the user picked — it does NOT prove they're
/// an authorized bus attendant. This service's only job is to produce a Firebase ID token; the
/// backend (POST /api/auth/operator-google-login) is what actually verifies it and decides
/// whether the account is a registered, active attendant. See ApiClient.loginWithGoogle.
enum GoogleAuthOutcomeType { success, cancelled, accountSelectionFailed, firebaseFailed }

class GoogleAuthOutcome {
  final GoogleAuthOutcomeType type;
  final String? idToken;
  final String? message;

  const GoogleAuthOutcome._(this.type, {this.idToken, this.message});

  const GoogleAuthOutcome.success(String idToken)
      : this._(GoogleAuthOutcomeType.success, idToken: idToken);

  const GoogleAuthOutcome.cancelled() : this._(GoogleAuthOutcomeType.cancelled);

  const GoogleAuthOutcome.accountSelectionFailed(String message)
      : this._(GoogleAuthOutcomeType.accountSelectionFailed, message: message);

  const GoogleAuthOutcome.firebaseFailed(String message)
      : this._(GoogleAuthOutcomeType.firebaseFailed, message: message);
}

class GoogleAuthService {
  final GoogleSignIn _googleSignIn = GoogleSignIn(scopes: const ['email']);

  /// Runs the full Google account picker -> Firebase sign-in flow and returns a fresh Firebase
  /// ID token on success. Never throws — every failure path (including the user simply closing
  /// the account picker) is reported through [GoogleAuthOutcome] so the caller can show the
  /// right message for each case.
  Future<GoogleAuthOutcome> signIn() async {
    GoogleSignInAccount? account;
    try {
      account = await _googleSignIn.signIn();
    } catch (e) {
      return GoogleAuthOutcome.accountSelectionFailed(
        'Could not open Google account selection: $e',
      );
    }
    if (account == null) {
      // User closed the account picker — not an error.
      return const GoogleAuthOutcome.cancelled();
    }

    try {
      final googleAuth = await account.authentication;
      final credential = fb.GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );
      final userCredential = await fb.FirebaseAuth.instance.signInWithCredential(credential);
      final idToken = await userCredential.user?.getIdToken();
      if (idToken == null || idToken.isEmpty) {
        return const GoogleAuthOutcome.firebaseFailed(
          'Firebase sign-in did not return a valid token.',
        );
      }
      return GoogleAuthOutcome.success(idToken);
    } catch (e) {
      // Leave no half-signed-in Google session behind — next attempt starts clean.
      try {
        await _googleSignIn.signOut();
      } catch (_) {}
      return GoogleAuthOutcome.firebaseFailed('Google sign-in failed: $e');
    }
  }

  /// Best-effort — safe to call even if the current session wasn't a Google one.
  Future<void> signOut() async {
    try {
      await _googleSignIn.signOut();
    } catch (_) {}
    try {
      await fb.FirebaseAuth.instance.signOut();
    } catch (_) {}
  }
}
