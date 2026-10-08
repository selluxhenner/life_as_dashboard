// lina-wake: "Hey Lina" for the Agentic OS desktop app (Windows).
// Listens on the default microphone with sherpa-onnx keyword spotting (the same model and phrases as the phone),
// and after the wake word records what Kevin says until he pauses. The app (src-tauri/src/lina.rs) runs it hidden
// and talks to it over stdin/stdout, one line per message:
//   out: READY | WAKE <keyword> | SPEECH <base64 wav> | NOSPEECH | ERROR <text>
//   in:  pause | resume | listen (record a follow-up without the wake word) | quit (or close stdin)
// Nothing leaves this process before the wake word; it keeps the last 1.5 s in memory so "Hey Lina, …" said in one
// breath arrives whole. Test without a microphone: lina-wake <model dir> <sensitivity> --wav file.wav
#include <windows.h>
#include <mmsystem.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sherpa-onnx/c-api/c-api.h"

#define RATE 16000
#define FRAME (RATE / 10)            /* 100 ms */
#define NBUF 10
#define PRE (RATE * 3 / 2)

static const SherpaOnnxKeywordSpotter *kws;
static const SherpaOnnxOnlineStream *ks;
static HWAVEIN mic;
static WAVEHDR hdr[NBUF];
static short bufs[NBUF][FRAME];
static int cur;
static HANDLE ev;
static volatile LONG paused, listenReq, quitting;
static short ring[PRE];
static int ringPos, ringFull;

static void say(const char *kind, const char *text) {
  fputs(kind, stdout);
  if (text) { fputc(' ', stdout); fputs(text, stdout); }
  fputc('\n', stdout);
  fflush(stdout);
}

static DWORD WINAPI input(LPVOID unused) {
  (void)unused;
  char line[64];
  while (fgets(line, sizeof line, stdin)) {
    if (!strncmp(line, "pause", 5)) InterlockedExchange(&paused, 1);
    else if (!strncmp(line, "resume", 6)) InterlockedExchange(&paused, 0);
    else if (!strncmp(line, "listen", 6)) InterlockedExchange(&listenReq, 1);
    else if (!strncmp(line, "quit", 4)) break;
  }
  InterlockedExchange(&quitting, 1);             /* the app closed us (or died): stop */
  SetEvent(ev);
  return 0;
}

/* ---------- microphone: a ring of 100 ms buffers, handed back in order ---------- */

static int openMic(void) {
  WAVEFORMATEX f = { WAVE_FORMAT_PCM, 1, RATE, RATE * 2, 2, 16, 0 };
  if (waveInOpen(&mic, WAVE_MAPPER, &f, (DWORD_PTR)ev, 0, CALLBACK_EVENT) != MMSYSERR_NOERROR) return 0;
  for (int i = 0; i < NBUF; i++) {
    hdr[i].lpData = (LPSTR)bufs[i];
    hdr[i].dwBufferLength = sizeof bufs[i];
    waveInPrepareHeader(mic, &hdr[i], sizeof hdr[i]);
    waveInAddBuffer(mic, &hdr[i], sizeof hdr[i]);
  }
  cur = 0;
  return waveInStart(mic) == MMSYSERR_NOERROR;
}

/* Waits for the next filled buffer. Returns its sample count (0 on timeout, -1 when quitting). */
static int nextFrame(short **out) {
  while (!(hdr[cur].dwFlags & WHDR_DONE)) {
    if (quitting) return -1;
    if (WaitForSingleObject(ev, 500) == WAIT_TIMEOUT) return 0;
  }
  *out = bufs[cur];
  return (int)(hdr[cur].dwBytesRecorded / 2);
}

static void giveBack(void) {
  hdr[cur].dwFlags &= ~WHDR_DONE;
  waveInAddBuffer(mic, &hdr[cur], sizeof hdr[cur]);
  cur = (cur + 1) % NBUF;
}

/* ---------- recording until a pause ---------- */

typedef struct { short *s; int n, cap; } Pcm;
static void put(Pcm *p, const short *s, int n) {
  if (p->n + n > p->cap) { p->cap = (p->n + n) * 2; p->s = realloc(p->s, p->cap * sizeof(short)); }
  memcpy(p->s + p->n, s, n * sizeof(short));
  p->n += n;
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static void sendWav(const Pcm *p) {
  int bytes = p->n * 2, total = 44 + bytes;
  unsigned char *w = malloc(total);
  int byteRate = RATE * 2;
  memcpy(w, "RIFF", 4); *(int *)(w + 4) = 36 + bytes; memcpy(w + 8, "WAVEfmt ", 8);
  *(int *)(w + 16) = 16; *(short *)(w + 20) = 1; *(short *)(w + 22) = 1; *(int *)(w + 24) = RATE;
  *(int *)(w + 28) = byteRate; *(short *)(w + 32) = 2; *(short *)(w + 34) = 16;
  memcpy(w + 36, "data", 4); *(int *)(w + 40) = bytes;
  memcpy(w + 44, p->s, bytes);
  char *b = malloc((total + 2) / 3 * 4 + 1), *o = b;
  for (int i = 0; i < total; i += 3) {
    unsigned v = w[i] << 16 | (i + 1 < total ? w[i + 1] << 8 : 0) | (i + 2 < total ? w[i + 2] : 0);
    *o++ = B64[v >> 18 & 63]; *o++ = B64[v >> 12 & 63];
    *o++ = i + 1 < total ? B64[v >> 6 & 63] : '=';
    *o++ = i + 2 < total ? B64[v & 63] : '=';
  }
  *o = 0;
  say("SPEECH", b);
  free(b); free(w);
}

/* Records until 1.1 s after the last speech, or waitMs without any, at most 25 s (same as the phone). */
static void record(const short *pre, int preN, int waitMs) {
  Pcm p = { 0 };
  if (preN) put(&p, pre, preN);
  double floor = 250;
  int speech = 0, quietMs = 0, ms = 0;
  while (!quitting && ms < 25000) {
    short *s;
    int n = nextFrame(&s);
    if (n < 0) break;
    if (n == 0) continue;
    put(&p, s, n);
    double sum = 0;
    for (int i = 0; i < n; i++) sum += (double)s[i] * s[i];
    giveBack();
    double rms = sqrt(sum / n);
    ms += n * 1000 / RATE;
    if (rms > fmax(600, floor * 2.5)) { speech = 1; quietMs = 0; }
    else { quietMs += n * 1000 / RATE; floor = floor * 0.95 + rms * 0.05; }
    if (!speech && ms >= waitMs) break;
    if (speech && quietMs >= 1100) break;
  }
  if (speech) sendWav(&p); else say("NOSPEECH", NULL);
  free(p.s);
}

/* ---------- keyword spotting ---------- */

static const char *feed(const short *s, int n) {
  static float f[FRAME];
  static char kw[64];
  for (int i = 0; i < n; i++) f[i] = s[i] / 32768.0f;
  SherpaOnnxOnlineStreamAcceptWaveform(ks, RATE, f, n);
  while (SherpaOnnxIsKeywordStreamReady(kws, ks)) {
    SherpaOnnxDecodeKeywordStream(kws, ks);
    const SherpaOnnxKeywordResult *r = SherpaOnnxGetKeywordResult(kws, ks);
    int hit = r && r->keyword && r->keyword[0];
    if (hit) snprintf(kw, sizeof kw, "%s", r->keyword);
    SherpaOnnxDestroyKeywordResult(r);
    if (hit) { SherpaOnnxResetKeywordStream(kws, ks); return kw; }
  }
  return NULL;
}

static int wavTest(const char *path) {
  FILE *fp = fopen(path, "rb");
  if (!fp) { say("ERROR", "cannot open wav"); return 1; }
  fseek(fp, 44, SEEK_SET);
  short s[FRAME];
  int n, at = 0;
  static short silence[FRAME * 5];
  feed(silence, FRAME);
  while ((n = (int)fread(s, 2, FRAME, fp)) > 0) {
    const char *k = feed(s, n);
    at += n;
    if (k) { char t[96]; snprintf(t, sizeof t, "%s at %.1f s", k, at / (double)RATE); say("WAKE", t); }
  }
  for (int i = 0; i < 5; i++) { const char *k = feed(silence, FRAME); if (k) say("WAKE", k); }
  fclose(fp);
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: lina-wake <model dir> [low|normal|high] [--wav file]\n"); return 2; }
  const char *dir = argv[1], *sens = argc > 2 ? argv[2] : "normal";
  char enc[MAX_PATH], dec[MAX_PATH], joi[MAX_PATH], tok[MAX_PATH], key[MAX_PATH];
  const char *m = "-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
  snprintf(enc, sizeof enc, "%s\\encoder%s", dir, m);
  snprintf(dec, sizeof dec, "%s\\decoder%s", dir, m);
  snprintf(joi, sizeof joi, "%s\\joiner%s", dir, m);
  snprintf(tok, sizeof tok, "%s\\tokens.txt", dir);
  snprintf(key, sizeof key, "%s\\keywords.txt", dir);

  SherpaOnnxKeywordSpotterConfig c;
  memset(&c, 0, sizeof c);
  c.feat_config.sample_rate = RATE;
  c.feat_config.feature_dim = 80;
  c.model_config.transducer.encoder = enc;
  c.model_config.transducer.decoder = dec;
  c.model_config.transducer.joiner = joi;
  c.model_config.tokens = tok;
  c.model_config.num_threads = 1;
  c.model_config.provider = "cpu";
  c.model_config.model_type = "zipformer2";
  c.max_active_paths = 4;
  c.num_trailing_blanks = 1;
  /* tuned on English and German test phrases, like the phone (android/app/lina) */
  c.keywords_score = !strcmp(sens, "low") ? 2.0f : !strcmp(sens, "high") ? 3.5f : 3.0f;
  c.keywords_threshold = !strcmp(sens, "low") ? 0.25f : !strcmp(sens, "high") ? 0.05f : 0.1f;
  c.keywords_file = key;
  kws = SherpaOnnxCreateKeywordSpotter(&c);
  if (!kws) { say("ERROR", "could not load the wake-word model"); return 1; }
  ks = SherpaOnnxCreateKeywordStream(kws);

  if (argc > 4 && !strcmp(argv[3], "--wav")) return wavTest(argv[4]);

  ev = CreateEvent(NULL, FALSE, FALSE, NULL);
  if (!openMic()) { say("ERROR", "no microphone"); return 1; }
  CreateThread(NULL, 0, input, NULL, 0, NULL);
  say("READY", NULL);

  while (!quitting) {
    short *s;
    int n = nextFrame(&s);
    if (n < 0) break;
    if (n == 0) continue;
    if (listenReq) {                                  /* a follow-up: Lina asked something back */
      giveBack();
      InterlockedExchange(&listenReq, 0);
      record(NULL, 0, 7000);
      continue;
    }
    if (paused) { giveBack(); continue; }             /* Lina is talking, or the app records itself */
    for (int i = 0; i < n; i++) { ring[ringPos++] = s[i]; if (ringPos == PRE) { ringPos = 0; ringFull = 1; } }
    const char *k = feed(s, n);
    giveBack();
    if (!k) continue;
    say("WAKE", k);
    static short pre[PRE];
    int preN = ringFull ? PRE : ringPos;
    if (ringFull) { memcpy(pre, ring + ringPos, (PRE - ringPos) * 2); memcpy(pre + PRE - ringPos, ring, ringPos * 2); }
    else memcpy(pre, ring, ringPos * 2);
    record(pre, preN, 5000);
    SherpaOnnxDestroyOnlineStream(ks);               /* forget what was said, so it can't complete a phrase */
    ks = SherpaOnnxCreateKeywordStream(kws);
    ringPos = 0; ringFull = 0;
    InterlockedExchange(&paused, 1);                  /* the app resumes us once Lina has answered */
  }
  waveInStop(mic);
  waveInReset(mic);
  for (int i = 0; i < NBUF; i++) waveInUnprepareHeader(mic, &hdr[i], sizeof hdr[i]);
  waveInClose(mic);
  SherpaOnnxDestroyOnlineStream(ks);
  SherpaOnnxDestroyKeywordSpotter(kws);
  return 0;
}
