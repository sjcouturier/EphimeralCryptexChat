import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AmbientBackgroundComponent } from '../../../shared/ambient-background/ambient-background.component';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AmbientBackgroundComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    if (this.auth.isAuthenticated()) {
      void this.router.navigate(['/channels']);
    }
  }

  establishIdentity(): void {
    this.auth.login();
  }

  openManual(): void {
    void this.router.navigate(['/manual']);
  }

  openPlayground(): void {
    void this.router.navigate(['/playground']);
  }
}
