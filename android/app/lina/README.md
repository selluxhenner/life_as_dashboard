# Lina wake word

`keywords.txt` lists the phrases the phone listens for ("Hey Lina", "Hi Lina", "Hoi Lina", "Hallo Lina", "Okay Lina").
Each line is the phrase in the model's BPE tokens, then `@NAME`. The model is English (GigaSpeech), so German and
Swiss German greetings are spelled the way they sound in English (Hoi → `▁HO I` and `▁HO Y`).

To add a phrase, tokenize it with the model's `bpe.model` (in the downloaded tarball under `libs/`):

```
pip install sentencepiece
python -c "import sentencepiece as s; print(' '.join(s.SentencePieceProcessor(model_file='bpe.model').encode('HEY LINA', out_type=str)))"
```

`lina.gradle` downloads the model and library and copies this file next to the model in the APK.
A wake that the server's transcript doesn't confirm ("Hey Linda") is dropped silently, so the spotter is tuned to
catch the phrase rather than to never misfire.
