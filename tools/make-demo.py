import numpy as np, wave, os, subprocess, tempfile
from pathlib import Path

sr = 44100
bpm = 122.0
beat = 60.0 / bpm
bar = beat * 4
bars = 24
duration = bar * bars
N = int(sr * duration)
t = np.arange(N, dtype=np.float64) / sr
bar_dur = bar
bar_idx = (np.floor(t / bar_dur).astype(np.int64)) % bars
bar_pos = t % bar_dur
beat_pos = t % beat
beat_index = np.floor(t / beat).astype(np.int64)
within_bar_beat = beat_index % 4
step_dur = beat / 4
step_pos = t % step_dur
step_idx = np.floor(t / step_dur).astype(np.int64)
eighth_dur = beat / 2
eighth_pos = t % eighth_dur
eighth_idx = np.floor(t / eighth_dur).astype(np.int64)

CH = np.array([
    [110.00, 130.81, 164.81, 220.00],  # Am
    [87.31, 110.00, 130.81, 174.61],   # F
    [130.81, 164.81, 196.00, 261.63],  # C
    [98.00, 123.47, 146.83, 196.00],   # G
])
chord = CH[bar_idx % 4]  # (N,4)
rng = np.random.default_rng(20261114)
noise = rng.uniform(-1, 1, N)
noise_prev = np.roll(noise, 1)

# arrangement masks
def seg(lo, hi):
    return (bar_idx >= lo) & (bar_idx < hi)

basic = seg(0, 2)
build = seg(2, 4)
full = seg(4, 12) | seg(14, 22)
breakdown = seg(12, 14)
outro = seg(22, 24)

drums = np.where(basic, .40, np.where(build, .72, np.where(breakdown, .16, np.where(outro, .52, 1.0))))
bass_gain = np.where(basic, 0.0, np.where(build, .8, np.where(breakdown, .18, np.where(outro, .55, 1.0))))
arp_gain = np.where(basic, .12, np.where(build, .62, np.where(breakdown, .9, np.where(outro, .45, 1.0))))
pad_gain = np.where(basic, .85, np.where(build, .92, 1.0))
section_fade = np.where(basic, .65 + bar_idx * .12, np.where(build, .78 + (bar_idx - 2) * .10, np.where(outro, .8 - (bar_idx - 22) * .24, 1.0)))

# sidechain
sidechain = 1 - .5 * np.exp(-beat_pos * 11)

# kick
kp = beat_pos
kick_phase = 2 * np.pi * (47 * kp + (92 / 33) * (1 - np.exp(-33 * kp)))
kick = (np.sin(kick_phase) * np.exp(-kp * 7.8) * .9 * drums
        + np.exp(-kp * 90) * .10 * drums * noise)

# clap on 2 and 4
clap_local = np.where((within_bar_beat == 1) | (within_bar_beat == 3), beat_pos, 0)
clap_env = np.exp(-clap_local * 19) * (((within_bar_beat == 1) | (within_bar_beat == 3)).astype(float))
clap = (noise * .58 + np.sin(2 * np.pi * 185 * clap_local) * .16) * clap_env * .26 * drums

# hats
hat_accent = np.where(step_idx % 2 == 0, 1.0, .62)
hat_open = np.where(step_idx % 8 == 6, 2.3, 1.0)
hat = (noise - noise_prev * .62) * np.exp(-step_pos * (58 / hat_open)) * .07 * hat_accent * drums

# bass
pattern = np.array([0, 0, 2, 0, 1, 0, 2, 3])
bass_note = chord[np.arange(N), pattern[eighth_idx % 8]] * .5
bx = 2 * np.pi * bass_note * eighth_pos
bass_env = np.exp(-eighth_pos * 5.2) * (.7 + .3 * np.exp(-eighth_pos * 1.5))
bass = (np.sin(bx) + .32 * np.sin(2 * bx) + .13 * np.sin(3 * bx)) * bass_env * .23 * bass_gain * sidechain

# pad
slow = .82 + .18 * np.sin(2 * np.pi * t / 12.7)
pad = np.zeros(N)
for i in range(3):
    f = chord[:, i] * 2.01
    pad += np.sin(2 * np.pi * f * t + i * 1.7) * .040
    pad += np.sin(2 * np.pi * f * 1.004 * t + .8) * .015
pad *= slow * pad_gain * sidechain

# arp with dotted echo
arp_pattern = np.array([0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2])
arp_note = chord[np.arange(N), arp_pattern[step_idx % 16]] * 4
ax = 2 * np.pi * arp_note * step_pos
arp = np.sin(ax + np.sin(2 * ax) * .22) * np.exp(-step_pos * 11) * .07 * arp_gain
echo_note = chord[np.arange(N), arp_pattern[(step_idx - 3) % 16]] * 4
echo_pos = (t - step_dur * 3) % step_dur
echo = np.sin(2 * np.pi * echo_note * echo_pos) * np.exp(-echo_pos * 9) * .024 * arp_gain
echo[t < step_dur * 3] = 0
arp += echo

# airy riser in bar 7/15/23
air = np.zeros(N)
for b in [7, 15, 23]:
    mask = (bar_idx % 24 == b) & (bar_pos > bar * .70)
    p = np.clip((bar_pos - bar * .70) / (bar * .30), 0, 1)
    air[mask] = noise[mask] * p[mask] ** 2 * .028

mix = (kick + clap + hat + bass + pad + arp + air) * (0.9 + 1.15 * 0.22)
mix = np.tanh(mix * 1.35) * .82 * section_fade

# gentle width: decorrelate highs only
d = np.diff(mix, prepend=mix[0])
left = mix + d * .10
right = mix - d * .10
# fade in/out
fade = np.ones(N)
fi = int(sr * 1.2)
fo = int(sr * 2.0)
fade[:fi] = np.linspace(0, 1, fi) ** .6
fade[-fo:] = np.linspace(1, 0, fo) ** .8
left *= fade
right *= fade
peak = max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-9)
gain = 0.92 / peak
left *= gain
right *= gain
stereo = np.stack([left, right], axis=1)
pcm = np.clip(stereo * 32767, -32768, 32767).astype(np.int16)

root = Path(__file__).resolve().parent.parent
out_dir = root / 'assets' / 'demo'
out_dir.mkdir(parents=True, exist_ok=True)
wavpath = str(Path(tempfile.gettempdir()) / 'neon-pulse.wav')
mp3path = out_dir / 'neon-pulse.mp3'
with wave.open(wavpath, 'wb') as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(sr)
    f.writeframes(pcm.tobytes())
print('wav', N, duration, 'peak', peak, 'gain', gain)
print('rms', float(np.sqrt(np.mean(mix ** 2))))
subprocess.run([
    'ffmpeg', '-y', '-loglevel', 'error', '-i', wavpath,
    '-codec:a', 'libmp3lame', '-b:a', '160k',
    '-metadata', 'title=Neon Pulse', '-metadata', 'artist=MilkDrop 3 Web',
    str(mp3path),
], check=True)
print('mp3', mp3path, mp3path.stat().st_size, 'octets')
