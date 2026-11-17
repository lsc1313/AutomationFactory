"""Windows-safe Edge TTS bridge (Python 3.9+).
The default Windows Proactor event loop can log late transport destructor errors.
"""
import argparse
import asyncio
import os
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def speak(voice, text, output):
    import edge_tts
    await edge_tts.Communicate(text=text, voice=voice).save(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--write-media", required=True)
    args = parser.parse_args()
    try:
        asyncio.run(speak(args.voice, args.text, args.write_media))
        if not os.path.isfile(args.write_media) or os.path.getsize(args.write_media) < 500:
            raise RuntimeError("No usable audio file was generated.")
        print("TTS_OK")
    except ModuleNotFoundError as exc:
        print("TTS_ERROR: edge_tts is not installed in this Python: " + str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception as exc:
        print("TTS_ERROR: " + type(exc).__name__ + ": " + str(exc), file=sys.stderr)
        sys.exit(3)
