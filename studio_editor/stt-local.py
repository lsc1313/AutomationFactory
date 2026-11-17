"""Optional CPU-only Whisper transcription. Runs locally. First run may download tiny model."""
import argparse
import json
import os
import subprocess
import sys
import tempfile

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--start', type=float, default=0)
    parser.add_argument('--duration', type=float, default=60)
    parser.add_argument('--language', default='auto')
    args = parser.parse_args()
    temp = tempfile.mktemp(suffix='.wav')
    try:
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',
            '-ss',str(max(0,args.start)),'-t',str(min(1200,args.duration)),
            '-i',args.input,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',temp],
            check=True,timeout=240)
        from faster_whisper import WhisperModel
        model = WhisperModel('tiny', device='cpu', compute_type='int8', cpu_threads=2)
        segments, info = model.transcribe(temp, beam_size=1,
            language=None if args.language=='auto' else args.language,
            vad_filter=True)
        result = [{'start':round(max(0,seg.start),2), 'end':round(max(0,seg.end),2),
                   'text':seg.text.strip()} for seg in segments if seg.text.strip()]
        with open(args.output,'w',encoding='utf8') as f:
            json.dump({'segments':result,'language':info.language},f,ensure_ascii=False)
        print('STT_OK')
    except ModuleNotFoundError:
        print('STT_ERROR: faster-whisper is missing. Run the updated one-click installer.',file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print('STT_ERROR: '+type(e).__name__+': '+str(e),file=sys.stderr)
        sys.exit(3)
    finally:
        try:
            if os.path.exists(temp): os.unlink(temp)
        except OSError: pass