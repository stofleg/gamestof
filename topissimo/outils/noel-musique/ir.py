# Réponse impulsionnelle de salle (2,6 s), stéréo décorrélée ; les aigus s'éteignent plus vite.
import numpy as np, wave
sr=44100; n=int(sr*2.6); t=np.arange(n)/sr; rng=np.random.default_rng(7)
out=[]
for ch in range(2):
    x=rng.standard_normal(n)
    # trois bandes avec décroissances différentes (graves longs, aigus courts)
    X=np.fft.rfft(x); f=np.fft.rfftfreq(n,1/sr)
    lo=np.fft.irfft(X*(f<800),n)*np.exp(-t/0.75); mid=np.fft.irfft(X*((f>=800)&(f<4000)),n)*np.exp(-t/0.5); hi=np.fft.irfft(X*(f>=4000),n)*np.exp(-t/0.25)
    y=lo+mid*.8+hi*.45
    y[:int(sr*.012)]*=np.linspace(0,1,int(sr*.012))   # pré-délai doux
    out.append(y)
a=np.stack(out,1); a/=np.abs(a).max()*1.05
w=wave.open("ir.wav","wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes((a*32767).astype(np.int16).tobytes()); w.close()
