package stirling.software.SPDF.security.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingClass;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

import jakarta.servlet.http.HttpServletResponse;

import lombok.RequiredArgsConstructor;

import stirling.software.SPDF.security.service.CustomUserDetailsService;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
@ConditionalOnMissingClass(
        "stirling.software.proprietary.security.configuration.SecurityConfiguration")
public class CustomSecurityConfig {

    private final CustomUserDetailsService userDetailsService;
    private final PasswordEncoder passwordEncoder;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
                .authenticationProvider(authenticationProvider())
                .authorizeHttpRequests(
                        auth ->
                                auth
                                        // Auth endpoints: login, logout, me — sin auth
                                        .requestMatchers("/api/v1/auth/**")
                                        .permitAll()
                                        // Admin de usuarios — solo ADMIN
                                        .requestMatchers("/api/v1/admin/users/**")
                                        .hasRole("ADMIN")
                                        // Todas las herramientas PDF — EDITOR o ADMIN
                                        .requestMatchers("/api/v1/**")
                                        .hasAnyRole("EDITOR", "ADMIN")
                                        // Archivos estáticos, frontend — sin auth
                                        .anyRequest()
                                        .permitAll())
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .exceptionHandling(
                        ex ->
                                ex.authenticationEntryPoint(
                                                (req, res, e) -> {
                                                    res.setStatus(
                                                            HttpServletResponse.SC_UNAUTHORIZED);
                                                    res.setContentType("application/json");
                                                    res.getWriter()
                                                            .write(
                                                                    "{\"error\":\"No"
                                                                            + " autenticado\",\"status\":401}");
                                                })
                                        .accessDeniedHandler(
                                                (req, res, e) -> {
                                                    res.setStatus(HttpServletResponse.SC_FORBIDDEN);
                                                    res.setContentType("application/json");
                                                    res.getWriter()
                                                            .write(
                                                                    "{\"error\":\"Acceso"
                                                                            + " denegado\",\"status\":403}");
                                                }));
        return http.build();
    }

    @Bean
    public DaoAuthenticationProvider authenticationProvider() {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return provider;
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config)
            throws Exception {
        return config.getAuthenticationManager();
    }
}
